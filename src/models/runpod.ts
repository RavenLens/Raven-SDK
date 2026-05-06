import runpodSdk from "runpod-sdk";
import { AIMessage, MessagesVariations } from "../agent/state";
import { InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";

export interface RunPodConfig extends LLMConfig {
	endpointId: string;
	/**
	 * Controls how the RunPod payload is sent to the vLLM worker.
	 * Defaults to "auto".
	 */
	inputMode?: "auto" | "messages" | "prompt";
	/**
	 * Timeout in milliseconds for the RunPod enqueue/runSync call.
	 */
	requestTimeout?: number;
	/**
	 * Timeout in milliseconds for streaming polling.
	 */
	streamTimeout?: number;
}

type RunPodChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

type RunPodPayload = {
	model: string;
	stream: boolean;
	messages?: RunPodChatMessage[];
	prompt?: string;
	[key: string]: unknown;
};

type RunPodSdkInstance = ReturnType<typeof runpodSdk>;
type RunPodEndpoint = NonNullable<ReturnType<RunPodSdkInstance["endpoint"]>>;

/**
 * Wrapper for RunPod Serverless vLLM endpoints.
 */
export class RunPod implements StandardLLMShema {
	apiName = { custom: "RunPod" } as const;
	config: RunPodConfig;
	baseURL?: string;

	private endpoint: RunPodEndpoint;

	constructor(config: RunPodConfig, baseURL?: string) {
		this.config = config;
		this.baseURL = config.baseURL ?? baseURL;

		if (!this.config.apiKey) {
			throw new Error("RunPod API key is required.");
		}

		if (!this.config.endpointId) {
			throw new Error("RunPod endpointId is required.");
		}

		const runpod = runpodSdk(
			this.config.apiKey,
			this.baseURL ? { baseUrl: this.baseURL } : undefined
		);

		const endpoint = runpod.endpoint(this.config.endpointId);

		if (!endpoint) {
			throw new Error(`Unable to resolve RunPod endpoint "${this.config.endpointId}".`);
		}

		this.endpoint = endpoint;
	}

	private getInputMode(): "messages" | "prompt" {
		if (this.config.inputMode === "messages" || this.config.inputMode === "prompt") {
			return this.config.inputMode;
		}

		const requiresStructuredMessages = this.config.messages.some((message) => {
			return message.type === "ai" || message.type === "thinking" || message.type === "tool";
		});

		return requiresStructuredMessages ? "messages" : "prompt";
	}

	private prepareChatMessages(): RunPodChatMessage[] {
		return this.config.messages.map((message) => {
			switch (message.type) {
				case "system":
					return {
						role: "system",
						content: message.content
					};
				case "user":
					return {
						role: "user",
						content: message.content
					};
				case "ai":
					return {
						role: "assistant",
						content: message.content ?? ""
					};
				case "thinking":
					return {
						role: "assistant",
						content: `Assistant thoughts: ${message.content}`
					};
				case "tool":
					return {
						role: "user",
						content: [
							`Tool response from ${message.tool_name ?? message.tool_id}:`,
							message.toolOutput ?? message.content
						].join("\n")
					};
			}
		});
	}

	private preparePrompt(): string {
		return this.config.messages
			.map((message) => {
				switch (message.type) {
					case "system":
						return `System: ${message.content}`;
					case "user":
						return `User: ${message.content}`;
					case "ai":
						return `Assistant: ${message.content ?? ""}`;
					case "thinking":
						return `Assistant thoughts: ${message.content}`;
					case "tool":
						return `Tool ${message.tool_name ?? message.tool_id}: ${message.toolOutput ?? message.content}`;
				}
			})
			.join("\n\n")
			.trim();
	}

	private buildInput(stream: boolean): RunPodPayload {
		const input: RunPodPayload = {
			model: this.config.model,
			stream
		};

		if (this.getInputMode() === "messages") {
			input.messages = this.prepareChatMessages();
		} else {
			input.prompt = this.preparePrompt();
		}

		return input;
	}

	private stringifyValue(value: unknown): string {
		if (typeof value === "string") {
			return value;
		}

		if (value === null || value === undefined) {
			return "";
		}

		if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
			return String(value);
		}

		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}

	private extractText(value: unknown): string {
		if (value === null || value === undefined) {
			return "";
		}

		if (typeof value === "string") {
			return value;
		}

		if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
			return String(value);
		}

		if (Array.isArray(value)) {
			const textParts = value
				.map((item) => this.extractText(item))
				.filter((part) => part.trim().length > 0);

			return textParts.join("\n").trim();
		}

		const record = value as Record<string, unknown>;

		if (typeof record.text === "string") {
			return record.text;
		}

		if (typeof record.content === "string") {
			return record.content;
		}

		if (typeof record.output === "string") {
			return record.output;
		}

		if (typeof record.response === "string") {
			return record.response;
		}

		if (typeof record.generated_text === "string") {
			return record.generated_text;
		}

		if (typeof record.message === "object" && record.message !== null) {
			const messageRecord = record.message as Record<string, unknown>;

			if (typeof messageRecord.content === "string") {
				return messageRecord.content;
			}
		}

		if (Array.isArray(record.choices) && record.choices.length > 0) {
			const choice = record.choices[0] as Record<string, unknown>;

			if (typeof choice.text === "string") {
				return choice.text;
			}

			if (typeof choice.message === "object" && choice.message !== null) {
				const choiceMessage = choice.message as Record<string, unknown>;

				if (typeof choiceMessage.content === "string") {
					return choiceMessage.content;
				}
			}
		}

		for (const nestedKey of ["output", "data", "result", "completion", "response", "stream"] as const) {
			const nestedValue = record[nestedKey];
			const nestedText = this.extractText(nestedValue);

			if (nestedText.trim().length > 0) {
				return nestedText;
			}
		}

		return this.stringifyValue(value);
	}

	private extractTokens(result: unknown): LLMAnswer["tokens"] {
		const resultRecord = result as Record<string, unknown>;
		const usageRecord = this.extractUsageRecord(resultRecord);

		return {
			input: this.readNumericValue(
				usageRecord?.input_tokens ??
					usageRecord?.prompt_tokens ??
					usageRecord?.input
			),
			output: this.readNumericValue(
				usageRecord?.output_tokens ??
					usageRecord?.completion_tokens ??
					usageRecord?.output
			),
			reasoning: this.readNumericValue(
				usageRecord?.reasoning_tokens ??
					this.readNestedReasoningTokens(usageRecord)
			)
		};
	}

	private extractUsageRecord(result: Record<string, unknown> | null): Record<string, unknown> | null {
		if (!result) {
			return null;
		}

		const directUsage = result.usage;

		if (directUsage && typeof directUsage === "object") {
			return directUsage as Record<string, unknown>;
		}

		const nestedOutput = result.output;

		if (nestedOutput && typeof nestedOutput === "object") {
			const nestedUsage = (nestedOutput as Record<string, unknown>).usage;

			if (nestedUsage && typeof nestedUsage === "object") {
				return nestedUsage as Record<string, unknown>;
			}
		}

		return null;
	}

	private readNestedReasoningTokens(value: Record<string, unknown> | null | undefined): unknown {
		if (!value) {
			return 0;
		}

		const outputDetails = value.output_tokens_details;

		if (outputDetails && typeof outputDetails === "object") {
			return (outputDetails as Record<string, unknown>).reasoning_tokens ?? 0;
		}

		return 0;
	}

	private readNumericValue(value: unknown): number {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		if (typeof value === "string") {
			const parsedValue = Number(value);

			if (Number.isFinite(parsedValue)) {
				return parsedValue;
			}
		}

		return 0;
	}

	private parseResponseToAnswer(response: unknown): LLMAnswer {
		const responseRecord = response as Record<string, unknown>;
		const output = responseRecord.output ?? response;
		const answerText = this.extractText(output).trim();

		const aiAnswer: AIMessage = {
			type: "ai",
			content: answerText.length > 0 ? answerText : this.stringifyValue(output)
		};

		return {
			messages: [
				...this.config.messages,
				aiAnswer
			],
			answer: [aiAnswer],
			tokens: this.extractTokens(responseRecord)
		};
	}

	async *stream(options?: InvokeOptions): AsyncGenerator<unknown, void, unknown> {
		if (options?.messages) {
			this.config.messages = options.messages;
		}

		const payload = {
			input: this.buildInput(true)
		};
		const request = await this.endpoint.run(payload, this.config.requestTimeout);

		for await (const chunk of this.endpoint.stream(request.id, this.config.streamTimeout)) {
			yield chunk;
		}
	}

	async invoke(): Promise<LLMAnswer>;
	async invoke(options?: { stream?: false | undefined; messages: InvokeOptions["messages"] }): Promise<LLMAnswer>;
	async invoke(options: { stream: true; messages: InvokeOptions["messages"] }): Promise<AsyncIterable<unknown>>;
	async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncIterable<unknown>> {
		if (options?.messages) {
			this.config.messages = options.messages;
		}

		if (options?.stream) {
			return this.stream(options);
		}

		const payload = {
			input: this.buildInput(false)
		};
		const response = await this.endpoint.runSync(payload, this.config.requestTimeout);

		return this.parseResponseToAnswer(response);
	}
}
