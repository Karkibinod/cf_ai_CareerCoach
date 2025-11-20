import { Hono } from "hono";
import { cors } from "hono/cors";
import { ResumeScannerDO } from "./ResumeScannerDO";
import { CourseRecommendationDO } from "./CourseRecommendationDO";

// Export Durable Objects for Wrangler - must be exported at module level
export { CareerCoachDO } from "./CareerCoachDO";
export { ResumeScannerDO };
export { CourseRecommendationDO };

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Enable CORS for frontend
app.use("*", cors());

// Health check endpoint
app.get("/message", (c) => {
	return c.text("Career Coach API is running!");
});

// Chat endpoint - handles user messages and LLM responses
app.post("/api/chat", async (c) => {
	try {
		const { message, sessionId } = await c.req.json<{
			message: string;
			sessionId?: string;
		}>();

		if (!message || typeof message !== "string") {
			return c.json({ error: "Message is required" }, 400);
		}

		// Generate or use provided session ID
		const id = c.env.CAREER_COACH.idFromName(sessionId || "default");
		const stub = c.env.CAREER_COACH.get(id);

		// Add user message to conversation history
		const historyResponse = await stub.fetch(
			new Request("http://do/message", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message, sessionId: sessionId || "default" }),
			}),
		);

		const { messages } = await historyResponse.json<{
			messages: Array<{ role: string; content: string }>;
		}>();

		// Prepare messages for LLM (convert to format expected by Llama)
		const llamaMessages = messages.map((msg) => ({
			role: msg.role === "system" ? "system" : msg.role === "user" ? "user" : "assistant",
			content: msg.content,
		}));

		// Call Workers AI with Llama models
		// Try different models with appropriate formats
		let aiResponse;
		let responseText = "";

		// Build prompt for models that use prompt format
		const promptText = llamaMessages
			.map((m) => {
				if (m.role === "system") return `System: ${m.content}`;
				if (m.role === "user") return `User: ${m.content}`;
				return `Assistant: ${m.content}`;
			})
			.join("\n\n") + "\n\nAssistant:";

		// Helper function to extract response text from AI response
		const extractResponse = (response: any): string => {
			if (typeof response === "string") {
				return response;
			}
			// Try different possible response formats
			if (response?.response) return response.response;
			if (response?.description) return response.description;
			if (response?.text) return response.text;
			if (response?.content) return response.content;
			if (response?.message) return response.message;
			// If it's an object with a single string property
			if (typeof response === "object" && response !== null) {
				const values = Object.values(response);
				if (values.length === 1 && typeof values[0] === "string") {
					return values[0];
				}
			}
			return "";
		};

		try {
			// Try Llama 2 7B chat (most commonly available)
			aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-fp16", {
				prompt: promptText,
				max_tokens: 512,
				temperature: 0.7,
			});
			responseText = extractResponse(aiResponse);
		} catch (error) {
			console.log("Llama 2 fp16 failed, trying int8:", error);
			try {
				// Fallback to int8 version
				aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
					prompt: promptText,
					max_tokens: 512,
					temperature: 0.7,
				});
				responseText = extractResponse(aiResponse);
			} catch (fallbackError) {
				console.log("Llama 2 int8 failed, trying Mistral:", fallbackError);
				// Try other available models
				try {
					aiResponse = await c.env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
						prompt: promptText,
						max_tokens: 512,
						temperature: 0.7,
					});
					responseText = extractResponse(aiResponse);
				} catch (finalError) {
					console.error("All AI models failed:", finalError);
					throw new Error(`No available AI models. Last error: ${finalError instanceof Error ? finalError.message : String(finalError)}`);
				}
			}
		}

		if (!responseText || responseText.trim() === "") {
			responseText = "I apologize, but I'm having trouble generating a response. Please try again or rephrase your question.";
		}

		// Save assistant response to conversation history
		await stub.fetch(
			new Request("http://do/add-message", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: responseText }),
			}),
		);

		return c.json({
			response: responseText,
			sessionId: sessionId || "default",
		});
	} catch (error) {
		console.error("Chat error:", error);
		return c.json(
			{
				error: "Failed to process chat message",
				details: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

// Get conversation history
app.get("/api/history/:sessionId", async (c) => {
	try {
		const sessionId = c.req.param("sessionId") || "default";
		const id = c.env.CAREER_COACH.idFromName(sessionId);
		const stub = c.env.CAREER_COACH.get(id);

		const response = await stub.fetch(new Request("http://do/history"));
		const data = await response.json();

		return c.json(data);
	} catch (error) {
		console.error("History error:", error);
		return c.json({ error: "Failed to get history" }, 500);
	}
});

// Clear conversation history
app.delete("/api/history/:sessionId", async (c) => {
	try {
		const sessionId = c.req.param("sessionId") || "default";
		const id = c.env.CAREER_COACH.idFromName(sessionId);
		const stub = c.env.CAREER_COACH.get(id);

		await stub.fetch(new Request("http://do/clear", { method: "DELETE" }));

		return c.json({ success: true });
	} catch (error) {
		console.error("Clear error:", error);
		return c.json({ error: "Failed to clear history" }, 500);
	}
});

// Resume scanner endpoint - analyzes uploaded resume with ATS ranking
app.post("/api/resume/scan", async (c) => {
	try {
		const formData = await c.req.formData();
		const file = formData.get("resume") as File;
		const resumeText = formData.get("resumeText") as string | null;
		const sessionId = formData.get("sessionId") as string | null || `resume-session-${Date.now()}`;

		if (!file && !resumeText) {
			return c.json({ error: "Resume file or text is required" }, 400);
		}

		let textContent = "";

		// If text is provided directly, use it
		if (resumeText) {
			textContent = resumeText;
		} else if (file) {
			// Extract text from file
			const fileType = file.type || "";
			const fileName = file.name || "";

			// Handle text files
			if (fileType.includes("text") || fileName.endsWith(".txt")) {
				textContent = await file.text();
			} else if (fileType.includes("pdf") || fileName.endsWith(".pdf")) {
				// PDF files should be processed client-side with pdf.js
				// If we receive a PDF file here, it means client-side extraction failed
				// The client should send the extracted text via resumeText instead
				return c.json({
					error: "PDF processing should be done client-side. Please ensure the PDF text was extracted properly, or paste the text content directly.",
					suggestion: "The PDF text extraction should happen automatically in your browser. If it failed, please paste the text content manually."
				}, 400);
			} else {
				// Try to read as text for other file types
				textContent = await file.text();
			}
		}

		if (!textContent || textContent.trim().length < 50) {
			return c.json({ error: "Resume content is too short or empty. Please provide a valid resume." }, 400);
		}

		// Use ResumeScannerDO for ATS analysis
		const id = c.env.RESUME_SCANNER.idFromName(sessionId);
		const stub = c.env.RESUME_SCANNER.get(id);

		// Get ATS score and ranking
		const atsResponse = await stub.fetch(
			new Request("http://do/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resumeText: textContent, sessionId }),
			}),
		);

		const atsData = await atsResponse.json<{
			resumeId: string;
			atsScore: number;
			atsRanking: string;
			strengths: string[];
			improvements: string[];
			keywords: { found: string[]; missing: string[] };
		}>();

		const resumeId = atsData.resumeId;

		// Prepare prompt for AI analysis with ATS context
		const analysisPrompt = `You are an expert career coach and resume reviewer. Analyze the following resume and provide comprehensive, constructive feedback.

**ATS Score: ${atsData.atsScore}/100 (${atsData.atsRanking})**

Focus on:

1. **Strengths**: What are the strong points of this resume? (Note: ${atsData.strengths.join(", ")})
2. **Areas for Improvement**: What could be enhanced? (Note: ${atsData.improvements.join(", ")})
3. **Formatting & Structure**: Is the resume well-organized and easy to read?
4. **Content Quality**: Are achievements quantified? Are skills relevant?
5. **ATS Optimization**: Provide specific recommendations to improve ATS compatibility
6. **Actionable Recommendations**: Specific suggestions to improve the resume

Resume Content:
${textContent.substring(0, 3000)}${textContent.length > 3000 ? "\n\n[Content truncated for analysis]" : ""}

Provide your feedback in a clear, professional, and encouraging manner. Include the ATS score context in your analysis.`;

		// Call Workers AI for resume analysis
		let aiResponse;
		let feedback = "";

		const extractResponse = (response: any): string => {
			if (typeof response === "string") return response;
			if (response?.response) return response.response;
			if (response?.description) return response.description;
			if (response?.text) return response.text;
			if (response?.content) return response.content;
			if (response?.message) return response.message;
			if (typeof response === "object" && response !== null) {
				const values = Object.values(response);
				if (values.length === 1 && typeof values[0] === "string") {
					return values[0];
				}
			}
			return "";
		};

		try {
			aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-fp16", {
				prompt: analysisPrompt,
				max_tokens: 1024,
				temperature: 0.7,
			});
			feedback = extractResponse(aiResponse);
		} catch (error) {
			console.log("Llama 2 fp16 failed, trying int8:", error);
			try {
				aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
					prompt: analysisPrompt,
					max_tokens: 1024,
					temperature: 0.7,
				});
				feedback = extractResponse(aiResponse);
			} catch (fallbackError) {
				console.log("Llama 2 int8 failed, trying Mistral:", fallbackError);
				try {
					aiResponse = await c.env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
						prompt: analysisPrompt,
						max_tokens: 1024,
						temperature: 0.7,
					});
					feedback = extractResponse(aiResponse);
				} catch (finalError) {
					console.error("All AI models failed:", finalError);
					throw new Error("Unable to analyze resume. Please try again.");
				}
			}
		}

		if (!feedback || feedback.trim() === "") {
			feedback = "I apologize, but I'm having trouble analyzing your resume. Please try again or ensure your resume content is clear and complete.";
		}

		// Save feedback to Durable Object
		await stub.fetch(
			new Request("http://do/update-feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resumeId, feedback }),
			}),
		);

		return c.json({
			feedback,
			success: true,
			resumeLength: textContent.length,
			atsScore: atsData.atsScore,
			atsRanking: atsData.atsRanking,
			strengths: atsData.strengths,
			improvements: atsData.improvements,
			keywords: atsData.keywords,
			resumeId,
		});
	} catch (error) {
		console.error("Resume scan error:", error);
		return c.json(
			{
				error: "Failed to analyze resume",
				details: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

// Get resume analysis history
app.get("/api/resume/history/:sessionId", async (c) => {
	try {
		const sessionId = c.req.param("sessionId") || `resume-session-${Date.now()}`;
		const id = c.env.RESUME_SCANNER.idFromName(sessionId);
		const stub = c.env.RESUME_SCANNER.get(id);

		const response = await stub.fetch(new Request("http://do/history"));
		const data = await response.json();

		return c.json(data);
	} catch (error) {
		console.error("History error:", error);
		return c.json({ error: "Failed to get history" }, 500);
	}
});

// Get specific resume analysis
app.get("/api/resume/analysis/:resumeId", async (c) => {
	try {
		const resumeId = c.req.param("resumeId");
		const sessionId = c.req.query("sessionId") || `resume-session-${Date.now()}`;
		const id = c.env.RESUME_SCANNER.idFromName(sessionId);
		const stub = c.env.RESUME_SCANNER.get(id);

		const response = await stub.fetch(new Request(`http://do/analysis/${resumeId}`));
		const data = await response.json();

		return c.json(data);
	} catch (error) {
		console.error("Analysis error:", error);
		return c.json({ error: "Failed to get analysis" }, 500);
	}
});

// Course and Certification Recommendations endpoint
app.post("/api/courses/recommend", async (c) => {
	try {
		const { jobTitle, sessionId } = await c.req.json<{
			jobTitle: string;
			sessionId?: string;
		}>();

		if (!jobTitle || typeof jobTitle !== "string" || jobTitle.trim().length < 2) {
			return c.json({ error: "Job title is required and must be at least 2 characters" }, 400);
		}

		const currentSessionId = sessionId || `course-session-${Date.now()}`;

		// Use CourseRecommendationDO
		const id = c.env.COURSE_RECOMMENDATIONS.idFromName(currentSessionId);
		const stub = c.env.COURSE_RECOMMENDATIONS.get(id);

		// Prepare prompt for AI to generate recommendations
		const recommendationPrompt = `You are an expert career advisor specializing in professional development and certifications. Based on the job title "${jobTitle.trim()}", provide personalized course and certification recommendations.

Please provide:
1. **Top 5-7 Relevant Courses** with:
   - Course name
   - Provider/platform (e.g., Coursera, Udemy, LinkedIn Learning, edX, etc.)
   - Brief description
   - Suggested duration/level (Beginner/Intermediate/Advanced)

2. **Top 5-7 Relevant Certifications** with:
   - Certification name
   - Issuing organization
   - Brief description
   - Suggested level (Entry-level/Mid-level/Senior)

3. **General Recommendations**: Provide 2-3 paragraphs of personalized advice on:
   - Which courses/certifications are most valuable for this role
   - Career progression path
   - Skills to prioritize
   - Industry trends to be aware of

Format your response clearly with sections for Courses, Certifications, and General Recommendations. Be specific and practical.`;

		// Call Workers AI for recommendations
		let aiResponse;
		let recommendations = "";

		const extractResponse = (response: any): string => {
			if (typeof response === "string") return response;
			if (response?.response) return response.response;
			if (response?.description) return response.description;
			if (response?.text) return response.text;
			if (response?.content) return response.content;
			if (response?.message) return response.message;
			if (typeof response === "object" && response !== null) {
				const values = Object.values(response);
				if (values.length === 1 && typeof values[0] === "string") {
					return values[0];
				}
			}
			return "";
		};

		try {
			aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-fp16", {
				prompt: recommendationPrompt,
				max_tokens: 1500,
				temperature: 0.7,
			});
			recommendations = extractResponse(aiResponse);
		} catch (error) {
			console.log("Llama 2 fp16 failed, trying int8:", error);
			try {
				aiResponse = await c.env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
					prompt: recommendationPrompt,
					max_tokens: 1500,
					temperature: 0.7,
				});
				recommendations = extractResponse(aiResponse);
			} catch (fallbackError) {
				console.log("Llama 2 int8 failed, trying Mistral:", fallbackError);
				try {
					aiResponse = await c.env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
						prompt: recommendationPrompt,
						max_tokens: 1500,
						temperature: 0.7,
					});
					recommendations = extractResponse(aiResponse);
				} catch (finalError) {
					console.error("All AI models failed:", finalError);
					throw new Error("Unable to generate recommendations. Please try again.");
				}
			}
		}

		if (!recommendations || recommendations.trim() === "") {
			recommendations = "I apologize, but I'm having trouble generating recommendations. Please try again with a more specific job title.";
		}

		// Parse recommendations to extract structured data (basic parsing)
		const courses = parseCoursesFromText(recommendations);
		const certifications = parseCertificationsFromText(recommendations);

		// Save to Durable Object
		const saveResponse = await stub.fetch(
			new Request("http://do/recommend", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jobTitle: jobTitle.trim(),
					sessionId: currentSessionId,
					courses,
					certifications,
					aiRecommendations: recommendations,
				}),
			}),
		);

		const savedData = await saveResponse.json<{
			recommendationId: string;
		}>();

		return c.json({
			recommendationId: savedData.recommendationId,
			jobTitle: jobTitle.trim(),
			courses,
			certifications,
			recommendations,
			success: true,
		});
	} catch (error) {
		console.error("Course recommendation error:", error);
		return c.json(
			{
				error: "Failed to generate recommendations",
				details: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

// Helper function to parse courses from AI text (basic implementation)
function parseCoursesFromText(text: string): Array<{
	name: string;
	provider: string;
	duration?: string;
	level?: string;
	description?: string;
}> {
	const courses: Array<{
		name: string;
		provider: string;
		duration?: string;
		level?: string;
		description?: string;
	}> = [];

	// Simple pattern matching for courses
	const courseSection = text.match(/courses?[:\-]?\s*(.*?)(?:certifications?|recommendations?|$)/is);
	if (courseSection) {
		const lines = courseSection[1].split(/\n/).filter(line => line.trim().length > 10);
		lines.slice(0, 7).forEach((line, index) => {
			if (line.match(/\d+\.|[-•*]/)) {
				const match = line.match(/(?:^|\d+\.|[-•*])\s*(.+?)(?:\s*[-–]\s*(.+?))?(?:\s*\((.+?)\))?/);
				if (match) {
					courses.push({
						name: match[1]?.trim() || `Course ${index + 1}`,
						provider: match[2]?.trim() || "Various",
						description: match[3]?.trim() || line.trim(),
					});
				}
			}
		});
	}

	return courses.length > 0 ? courses : [
		{ name: "See AI recommendations below", provider: "Various", description: "Detailed course recommendations are provided in the text" }
	];
}

// Helper function to parse certifications from AI text (basic implementation)
function parseCertificationsFromText(text: string): Array<{
	name: string;
	issuer: string;
	duration?: string;
	level?: string;
	description?: string;
}> {
	const certifications: Array<{
		name: string;
		issuer: string;
		duration?: string;
		level?: string;
		description?: string;
	}> = [];

	// Simple pattern matching for certifications
	const certSection = text.match(/certifications?[:\-]?\s*(.*?)(?:recommendations?|$)/is);
	if (certSection) {
		const lines = certSection[1].split(/\n/).filter(line => line.trim().length > 10);
		lines.slice(0, 7).forEach((line, index) => {
			if (line.match(/\d+\.|[-•*]/)) {
				const match = line.match(/(?:^|\d+\.|[-•*])\s*(.+?)(?:\s*[-–]\s*(.+?))?(?:\s*\((.+?)\))?/);
				if (match) {
					certifications.push({
						name: match[1]?.trim() || `Certification ${index + 1}`,
						issuer: match[2]?.trim() || "Various",
						description: match[3]?.trim() || line.trim(),
					});
				}
			}
		});
	}

	return certifications.length > 0 ? certifications : [
		{ name: "See AI recommendations below", issuer: "Various", description: "Detailed certification recommendations are provided in the text" }
	];
}

// Get course recommendation history
app.get("/api/courses/history/:sessionId", async (c) => {
	try {
		const sessionId = c.req.param("sessionId") || `course-session-${Date.now()}`;
		const id = c.env.COURSE_RECOMMENDATIONS.idFromName(sessionId);
		const stub = c.env.COURSE_RECOMMENDATIONS.get(id);

		const response = await stub.fetch(new Request("http://do/history"));
		const data = await response.json();

		return c.json(data);
	} catch (error) {
		console.error("History error:", error);
		return c.json({ error: "Failed to get history" }, 500);
	}
});

export default app;
