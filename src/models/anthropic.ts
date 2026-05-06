import { InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { Anthropic as AnthropicStandalone } from '@anthropic-ai/sdk';
import { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { parseToolCallContentToParams, parseToolDescription } from "../agent/tools";
import { AIMessage, ReasoningMessage, ToolMessage } from "../agent/state";
import * as z from "zod";
import { ThinkingConfigParam } from "@anthropic-ai/sdk/resources";

export interface AnthropicConfig extends LLMConfig {
    thinking?: ThinkingConfigParam;
    /** As default max tokens are 1024 */
    max_tokens?: number;
}

interface AnthropicAIEvents {
    stream: (event: AnthropicStandalone.Messages.RawMessageStreamEvent) => void | Promise<void>;
}

export class Anthropic implements StandardLLMShema {
    apiName = "Anthropic" as const;
    private anthropic: AnthropicStandalone;
    private EventsListeners: Partial<{ [EventName in keyof AnthropicAIEvents]: AnthropicAIEvents[EventName] }> = {};
    baseURL?: string;
    config: AnthropicConfig;
    
    constructor(config: AnthropicConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.anthropic = new AnthropicStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL
        })
    }

    private prepareMessages(): MessageParam[] {
        return this.config.messages
            .filter((message) => message.type !== "system")
            .map((message) => {
            switch (message.type) {
                case "user":
                    return {
                        role: "user",
                        content: message.content
                    } satisfies MessageParam;
                case "ai":
                    return {
                        role: "assistant",
                        content: message.content ?? ""
                    } satisfies MessageParam;
                case "thinking":
                    // Anthropic requires model-issued signatures for thinking blocks.
                    // If no signature is present, degrade to assistant text instead of sending an invalid block.
                    if (!message.signature) {
                        return {
                            role: "assistant",
                            content: `Assistant thoughts: ${message.content}`
                        } satisfies MessageParam;
                    }

                    return {
                        role: "assistant",
                        content: [
                            {
                                type: "thinking",
                                thinking: message.content,
                                signature: message.signature
                            }
                        ]
                    } satisfies MessageParam
                case "tool":
                    return {
                        role: "user",
                        content: [
                            {
                                type: "tool_result",
                                tool_use_id: message.tool_id,
                                content: message.content
                            }
                        ]
                    } satisfies MessageParam;
            }
        });
    }

    private prepareSystemPrompt(): string | undefined {
        const systemMessages = this.config.messages
            .filter((message): message is { type: "system"; content: string } => message.type === "system")
            .map((message) => message.content.trim())
            .filter((content) => content.length > 0);

        if (!systemMessages.length) {
            return undefined;
        }

        return systemMessages.join("\n\n");
    }

    private prepareTools(): Tool[] {
        return this.config.tools.map((tool) => {
            const inputSchemaRaw = z.toJSONSchema(tool.toolConfig.toolArguments);

            return {
                name: tool.toolConfig.toolName,
                description: parseToolDescription(tool.toolConfig),
                input_schema: {
                    type: "object",
                    ...(inputSchemaRaw as Record<string, unknown>)
                }
            } satisfies Tool;
        });
    }

    onEvent<EventName extends keyof AnthropicAIEvents>(eventName: EventName, eventListener: AnthropicAIEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof AnthropicAIEvents>(eventName: EventName, ...eventArgs: Parameters<AnthropicAIEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as AnthropicAIEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }
    
    private async *streamWithEvents(stream: AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>) {
        for await (const event of stream) {
            this.emitEvent("stream", event);
            yield event;
        }
    }

    private prepareSyncAnswer(completion: AnthropicStandalone.Messages.Message & { _request_id?: string | null; }) {
        // Obtain answer content
        const answerContentText = completion.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
        const answerTools = completion.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

        // Prepare answer 
        const calledToolsMessage = answerTools.map((toolUse) => {
            const content = typeof toolUse.input === "string" ? toolUse.input : JSON.stringify(toolUse.input);

            return {
                type: "tool",
                tool_id: toolUse.id,
                tool_name: toolUse.name,
                content,
                arguments: parseToolCallContentToParams(content)
            } satisfies ToolMessage;
        });
        const thinkingReasonMessage: ReasoningMessage[] | null = completion.content.some(content => content.type === "thinking") ? completion.content
            .filter(content => content.type === "thinking")
            .map(content => ({
                type: "thinking",
                content: content.thinking,
                signature: content.signature
            })) : null;
        const aiAnswer: AIMessage | null = answerContentText
            ? {
                type: "ai",
                content: answerContentText,
                calledTools: calledToolsMessage
            }
            : null;
        const answer: (ReasoningMessage | AIMessage | ToolMessage)[] = [
            ...(thinkingReasonMessage ?? []),
            ...(aiAnswer ? [aiAnswer] : []),
            ...calledToolsMessage
        ].filter(v => v !== null);

        // Output message
        return {
            messages: [
                ...this.config.messages,
                ...answer
            ],
            answer,
            tokens: {
                input: completion.usage.input_tokens,
                output: completion.usage.output_tokens,
                reasoning: 0
            }
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options?: { stream?: false | undefined, messages: InvokeOptions["messages"] } | undefined): Promise<LLMAnswer>;
    async invoke(options: { stream: true, messages: InvokeOptions["messages"] }): Promise<AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>>;
    async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>> {
        if (options?.messages) {
            this.config.messages = options.messages;
        }
        
        const config: AnthropicStandalone.Messages.MessageCreateParamsNonStreaming = {
            model: this.config.model,
            max_tokens: this.config.max_tokens ?? 1024,
            system: this.prepareSystemPrompt(),
            messages: this.prepareMessages(),
            tools: this.prepareTools(),
            thinking: this.config.thinking
        }
        
        if (options?.stream) {
            const streamCompletion = this.anthropic.messages.stream(config);
            return this.streamWithEvents(streamCompletion);
        } else {
            // Execute llm
            const completion = await this.anthropic.messages.create(config);
            return this.prepareSyncAnswer(completion);
        }
    }
}