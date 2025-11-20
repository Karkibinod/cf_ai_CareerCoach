import { DurableObject } from "cloudflare:workers";

export interface CourseRecommendation {
	recommendationId: string;
	jobTitle: string;
	courses: Course[];
	certifications: Certification[];
	aiRecommendations: string;
	createdAt: number;
	updatedAt: number;
}

export interface Course {
	name: string;
	provider: string;
	duration?: string;
	level?: string;
	description?: string;
	url?: string;
}

export interface Certification {
	name: string;
	issuer: string;
	duration?: string;
	level?: string;
	description?: string;
	url?: string;
}

export interface RecommendationState {
	recommendations: CourseRecommendation[];
	sessionId: string;
	createdAt: number;
	updatedAt: number;
}

export class CourseRecommendationDO extends DurableObject {
	private state: RecommendationState | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "POST" && path === "/recommend") {
			return this.createRecommendation(request);
		} else if (request.method === "GET" && path === "/history") {
			return this.getHistory();
		} else if (request.method === "GET" && path === "/recommendation/:recommendationId") {
			return this.getRecommendation(request);
		} else if (request.method === "DELETE" && path === "/clear") {
			return this.clearHistory();
		}

		return new Response("Not Found", { status: 404 });
	}

	private async createRecommendation(request: Request): Promise<Response> {
		const { jobTitle, sessionId, courses, certifications, aiRecommendations } = await request.json<{
			jobTitle: string;
			sessionId: string;
			courses?: Course[];
			certifications?: Certification[];
			aiRecommendations?: string;
		}>();

		if (!jobTitle || jobTitle.trim().length < 2) {
			return Response.json({ error: "Job title is required" }, 400);
		}

		// Load or initialize state
		await this.loadState(sessionId);

		// Generate recommendation ID
		const recommendationId = `rec-${Date.now()}-${Math.random().toString(36).substring(7)}`;

		// Create recommendation
		const recommendation: CourseRecommendation = {
			recommendationId,
			jobTitle: jobTitle.trim(),
			courses: courses || [],
			certifications: certifications || [],
			aiRecommendations: aiRecommendations || "",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		this.state!.recommendations.push(recommendation);
		this.state!.updatedAt = Date.now();
		await this.saveState();

		return Response.json({
			recommendationId,
			jobTitle: recommendation.jobTitle,
			courses: recommendation.courses,
			certifications: recommendation.certifications,
			aiRecommendations: recommendation.aiRecommendations,
		});
	}

	private async getHistory(): Promise<Response> {
		const state = await this.ctx.storage.get<RecommendationState>("state");
		if (!state) {
			return Response.json({ recommendations: [] });
		}
		return Response.json(state);
	}

	private async getRecommendation(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const recommendationId = url.pathname.split("/").pop();

		const state = await this.ctx.storage.get<RecommendationState>("state");
		if (!state) {
			return Response.json({ error: "No recommendations found" }, 404);
		}

		const recommendation = state.recommendations.find(r => r.recommendationId === recommendationId);
		if (!recommendation) {
			return Response.json({ error: "Recommendation not found" }, 404);
		}

		return Response.json(recommendation);
	}

	private async clearHistory(): Promise<Response> {
		await this.ctx.storage.delete("state");
		this.state = null;
		return Response.json({ success: true });
	}

	private async loadState(sessionId: string): Promise<void> {
		if (!this.state) {
			const stored = await this.ctx.storage.get<RecommendationState>("state");
			if (stored && stored.sessionId === sessionId) {
				this.state = stored;
			} else {
				this.state = {
					recommendations: [],
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
}


