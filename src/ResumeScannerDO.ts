import { DurableObject } from "cloudflare:workers";

export interface ResumeAnalysis {
	resumeId: string;
	resumeText: string;
	atsScore: number;
	atsRanking: "Excellent" | "Good" | "Fair" | "Needs Improvement";
	feedback: string;
	strengths: string[];
	improvements: string[];
	keywords: {
		found: string[];
		missing: string[];
	};
	createdAt: number;
	updatedAt: number;
}

export interface ResumeState {
	analyses: ResumeAnalysis[];
	sessionId: string;
	createdAt: number;
	updatedAt: number;
}

export class ResumeScannerDO extends DurableObject {
	private state: ResumeState | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "POST" && path === "/analyze") {
			return this.analyzeResume(request);
		} else if (request.method === "GET" && path === "/history") {
			return this.getHistory();
		} else if (request.method === "GET" && path === "/analysis/:resumeId") {
			return this.getAnalysis(request);
		} else if (request.method === "DELETE" && path === "/clear") {
			return this.clearHistory();
		}

		return new Response("Not Found", { status: 404 });
	}

	private async analyzeResume(request: Request): Promise<Response> {
		const { resumeText, sessionId } = await request.json<{
			resumeText: string;
			sessionId: string;
		}>();

		if (!resumeText || resumeText.trim().length < 50) {
			return Response.json({ error: "Resume text is required and must be at least 50 characters" }, 400);
		}

		// Load or initialize state
		await this.loadState(sessionId);

		// Calculate ATS score and ranking
		const atsAnalysis = this.calculateATSScore(resumeText);

		// Generate resume ID
		const resumeId = `resume-${Date.now()}-${Math.random().toString(36).substring(7)}`;

		// Store analysis (feedback will be added by the main worker after AI processing)
		const analysis: ResumeAnalysis = {
			resumeId,
			resumeText: resumeText.substring(0, 5000), // Store first 5000 chars
			atsScore: atsAnalysis.score,
			atsRanking: atsAnalysis.ranking,
			feedback: "", // Will be populated by AI
			strengths: atsAnalysis.strengths,
			improvements: atsAnalysis.improvements,
			keywords: atsAnalysis.keywords,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		this.state!.analyses.push(analysis);
		this.state!.updatedAt = Date.now();
		await this.saveState();

		return Response.json({
			resumeId,
			atsScore: analysis.atsScore,
			atsRanking: analysis.atsRanking,
			strengths: analysis.strengths,
			improvements: analysis.improvements,
			keywords: analysis.keywords,
		});
	}

	private calculateATSScore(resumeText: string): {
		score: number;
		ranking: "Excellent" | "Good" | "Fair" | "Needs Improvement";
		strengths: string[];
		improvements: string[];
		keywords: { found: string[]; missing: string[] };
	} {
		const text = resumeText.toLowerCase();
		let score = 0;
		const strengths: string[] = [];
		const improvements: string[] = [];
		const foundKeywords: string[] = [];
		const missingKeywords: string[] = [];

		// Common ATS keywords to check
		const importantKeywords = [
			"experience", "education", "skills", "achievement", "certification",
			"leadership", "project", "result", "improve", "manage", "develop",
			"implement", "collaborate", "communication", "problem solving",
			"technical", "professional", "quantify", "metric", "percentage"
		];

		// Check for keywords
		importantKeywords.forEach(keyword => {
			if (text.includes(keyword)) {
				score += 2;
				foundKeywords.push(keyword);
			} else {
				missingKeywords.push(keyword);
			}
		});

		// Check for quantified achievements (numbers, percentages, etc.)
		const hasNumbers = /\d+/.test(resumeText);
		const hasPercentages = /%\s|\d+%/.test(resumeText);
		if (hasNumbers || hasPercentages) {
			score += 15;
			strengths.push("Contains quantified achievements with numbers/metrics");
		} else {
			improvements.push("Add quantified achievements (numbers, percentages, metrics)");
		}

		// Check for action verbs
		const actionVerbs = [
			"achieved", "managed", "developed", "implemented", "created",
			"improved", "increased", "reduced", "led", "designed", "built"
		];
		const actionVerbCount = actionVerbs.filter(verb => text.includes(verb)).length;
		if (actionVerbCount >= 5) {
			score += 10;
			strengths.push("Uses strong action verbs");
		} else if (actionVerbCount < 3) {
			improvements.push("Use more action verbs to describe achievements");
		}

		// Check for contact information
		const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(resumeText);
		const hasPhone = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/.test(resumeText);
		if (hasEmail && hasPhone) {
			score += 5;
			strengths.push("Contains complete contact information");
		} else {
			improvements.push("Ensure contact information (email and phone) is included");
		}

		// Check for section headers
		const commonSections = ["experience", "education", "skills", "summary", "objective", "certifications"];
		const sectionCount = commonSections.filter(section => {
			const regex = new RegExp(`\\b${section}\\b`, "i");
			return regex.test(resumeText);
		}).length;
		if (sectionCount >= 4) {
			score += 10;
			strengths.push("Well-organized with clear section headers");
		} else {
			improvements.push("Add clear section headers (Experience, Education, Skills, etc.)");
		}

		// Check resume length (optimal is 1-2 pages, ~500-1000 words)
		const wordCount = resumeText.split(/\s+/).length;
		if (wordCount >= 400 && wordCount <= 1000) {
			score += 10;
			strengths.push("Appropriate length for ATS systems");
		} else if (wordCount < 200) {
			score -= 10;
			improvements.push("Resume is too short - add more detail");
		} else if (wordCount > 1500) {
			score -= 5;
			improvements.push("Resume may be too long - consider condensing");
		}

		// Check for keywords density (avoid keyword stuffing)
		const keywordDensity = foundKeywords.length / importantKeywords.length;
		if (keywordDensity >= 0.6 && keywordDensity <= 0.9) {
			score += 5;
			strengths.push("Good keyword usage without overstuffing");
		}

		// Normalize score to 0-100
		score = Math.max(0, Math.min(100, score));

		// Determine ranking
		let ranking: "Excellent" | "Good" | "Fair" | "Needs Improvement";
		if (score >= 80) {
			ranking = "Excellent";
		} else if (score >= 60) {
			ranking = "Good";
		} else if (score >= 40) {
			ranking = "Fair";
		} else {
			ranking = "Needs Improvement";
		}

		return {
			score,
			ranking,
			strengths,
			improvements,
			keywords: {
				found: foundKeywords,
				missing: missingKeywords.slice(0, 5), // Limit missing keywords
			},
		};
	}

	private async getHistory(): Promise<Response> {
		const state = await this.ctx.storage.get<ResumeState>("state");
		if (!state) {
			return Response.json({ analyses: [] });
		}
		return Response.json(state);
	}

	private async updateFeedback(request: Request): Promise<Response> {
		const { resumeId, feedback } = await request.json<{
			resumeId: string;
			feedback: string;
		}>();

		if (!this.state) {
			const stored = await this.ctx.storage.get<ResumeState>("state");
			if (stored) {
				this.state = stored;
			} else {
				return Response.json({ error: "No state found" }, 404);
			}
		}

		const analysis = this.state.analyses.find(a => a.resumeId === resumeId);
		if (analysis) {
			analysis.feedback = feedback;
			analysis.updatedAt = Date.now();
			await this.saveState();
			return Response.json({ success: true });
		}

		return Response.json({ error: "Analysis not found" }, 404);
	}

	private async getAnalysis(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const resumeId = url.pathname.split("/").pop();

		const state = await this.ctx.storage.get<ResumeState>("state");
		if (!state) {
			return Response.json({ error: "No analyses found" }, 404);
		}

		const analysis = state.analyses.find(a => a.resumeId === resumeId);
		if (!analysis) {
			return Response.json({ error: "Analysis not found" }, 404);
		}

		return Response.json(analysis);
	}

	private async clearHistory(): Promise<Response> {
		await this.ctx.storage.delete("state");
		this.state = null;
		return Response.json({ success: true });
	}

	private async loadState(sessionId: string): Promise<void> {
		if (!this.state) {
			const stored = await this.ctx.storage.get<ResumeState>("state");
			if (stored && stored.sessionId === sessionId) {
				this.state = stored;
			} else {
				this.state = {
					analyses: [],
					sessionId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				};
			}
		}
	}

	private async saveState(): Promise<void> {
		if (this.state) {
			await this.ctx.storage.put("state", this.state);
		}
	}

	async updateAnalysisFeedback(resumeId: string, feedback: string): Promise<void> {
		if (!this.state) {
			const stored = await this.ctx.storage.get<ResumeState>("state");
			if (stored) {
				this.state = stored;
			} else {
				return;
			}
		}

		const analysis = this.state.analyses.find(a => a.resumeId === resumeId);
		if (analysis) {
			analysis.feedback = feedback;
			analysis.updatedAt = Date.now();
			await this.saveState();
		}
	}
}

