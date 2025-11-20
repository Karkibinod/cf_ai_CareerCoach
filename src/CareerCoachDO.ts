import { DurableObject } from "cloudflare:workers";

export interface ConversationMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

export interface ConversationState {
	messages: ConversationMessage[];
	sessionId: string;
	createdAt: number;
	updatedAt: number;
}

export class CareerCoachDO extends DurableObject {
	private state: ConversationState | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "POST" && path === "/message") {
			return this.handleMessage(request);
		} else if (request.method === "POST" && path === "/add-message") {
			return this.addAssistantMessage(request);
		} else if (request.method === "GET" && path === "/history") {
			return this.getHistory();
		} else if (request.method === "DELETE" && path === "/clear") {
			return this.clearHistory();
		}

		return new Response("Not Found", { status: 404 });
	}

	private async handleMessage(request: Request): Promise<Response> {
		const { message, sessionId } = await request.json<{
			message: string;
			sessionId: string;
		}>();

		// Load or initialize state
		await this.loadState(sessionId);

		// Add user message to history
		const userMessage: ConversationMessage = {
			role: "user",
			content: message,
			timestamp: Date.now(),
		};

		this.state!.messages.push(userMessage);
		this.state!.updatedAt = Date.now();

		// Save state
		await this.saveState();

		// Return conversation history for LLM processing
		return Response.json({
			messages: this.state!.messages,
			sessionId: this.state!.sessionId,
		});
	}

	private async getHistory(): Promise<Response> {
		const state = await this.ctx.storage.get<ConversationState>("state");
		if (!state) {
			return Response.json({ messages: [], sessionId: null });
		}
		return Response.json(state);
	}

	private async clearHistory(): Promise<Response> {
		await this.ctx.storage.delete("state");
		this.state = null;
		return Response.json({ success: true });
	}

	private async loadState(sessionId: string): Promise<void> {
		if (!this.state) {
			const stored = await this.ctx.storage.get<ConversationState>("state");
			if (stored && stored.sessionId === sessionId) {
				this.state = stored;
			} else {
				this.state = {
					messages: [
						{
							role: "system",
							content:
								"You are a helpful and empathetic AI career coach. Your role is to guide users through career decisions, provide advice on professional development, help with job search strategies, and offer support for career transitions. Be encouraging, practical, and personalized in your responses.",
							timestamp: Date.now(),
						},
					],
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

	private async addAssistantMessage(request: Request): Promise<Response> {
		const { message } = await request.json<{ message: string }>();
		
		// Ensure state is loaded
		if (!this.state) {
			const stored = await this.ctx.storage.get<ConversationState>("state");
			if (stored) {
				this.state = stored;
			} else {
				return Response.json({ error: "No active session" }, 400);
			}
		}

		const assistantMessage: ConversationMessage = {
			role: "assistant",
			content: message,
			timestamp: Date.now(),
		};

		this.state.messages.push(assistantMessage);
		this.state.updatedAt = Date.now();
		await this.saveState();

		return Response.json({ success: true });
	}
}

