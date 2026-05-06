import { LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { OpenAI as OpenAIStandalone } from 'openai';
import type * as ResponsesAPI from "openai/resources/responses/responses";
import { parseToolCallContentToParams, parseToolDescription } from "../agent/tools";
import { AIMessage, ToolMessage } from "../agent/state";
import { ReasoningEffort } from "openai/resources";

export interface OpenAIConfig extends LLMConfig {
    reasoningEffort?: ReasoningEffort | null
}

export interface OpenAIInvokeOptions {
    stream?: boolean;
}

interface OpenAIEvents {
    stream: (event: ResponsesAPI.ResponseStreamEvent) => void | Promise<void>;
}

/**
 * Wrapper for OpenAI for RavenADK
*/
export class OpenAI implements StandardLLMShema {    
    private openai: OpenAIStandalone;
    private EventsListeners: Partial<{ [EventName in keyof OpenAIEvents]: OpenAIEvents[EventName] }> = {};
    config: OpenAIConfig;
    baseURL?: string;

    constructor(config: OpenAIConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.openai = new OpenAIStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL
        })
    }

    onEvent<EventName extends keyof OpenAIEvents>(eventName: EventName, eventListener: OpenAIEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof OpenAIEvents>(eventName: EventName, ...eventArgs: Parameters<OpenAIEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as OpenAIEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    /** Parse messages and return in Responses API format */
    private prepareInput(): ResponsesAPI.ResponseInputItem[] {
        return this.config.messages.map((message => { // Parse messages to openai compatible format
            switch(message.type) {
                case "user":
                    return {
                        role: "user",
                        content: message.content
                    } satisfies ResponsesAPI.EasyInputMessage
                case "ai":
                    return {
                        role: "assistant",
                        content: message.content ?? ""
                    } satisfies ResponsesAPI.EasyInputMessage
                case "thinking":
                    return {
                        role: "assistant",
                        content: `Assistant thoughts: ${message.content}`
                    } satisfies ResponsesAPI.EasyInputMessage
                case "tool":
                    return {
                        type: "custom_tool_call_output",
                        call_id: message.tool_id,
                        output: message.content
                    } satisfies ResponsesAPI.ResponseCustomToolCallOutput
            }
        }));
    }

    private prepareTools(): ResponsesAPI.CustomTool[] {
        return this.config.tools.map(tool => {
            return {
                type: "custom",
                name: tool.toolConfig.toolName,
                description: parseToolDescription(tool.toolConfig)
            }
        })
    }

    private prepareCreatePayload(): Omit<ResponsesAPI.ResponseCreateParamsBase, "stream"> {
        return {
            model: this.config.model,
            reasoning: {
                effort: this.config.reasoningEffort ?? undefined
            },
            input: this.prepareInput(),
            tools: this.prepareTools()
        };
    }

    private parseResponseToAnswer(response: ResponsesAPI.Response): LLMAnswer {
        const answerContentText = response.output_text?.trim() ? response.output_text : null;
        const answerTools = response.output.filter((outputItem): outputItem is ResponsesAPI.ResponseCustomToolCall => outputItem.type === "custom_tool_call");

        // Map output for answer
        const calledToolsMessage = answerTools.map(toolCall => {
            return {
                type: "tool",
                tool_id: toolCall.call_id,
                content: toolCall.input,
                parameters: parseToolCallContentToParams(toolCall.input)
            } satisfies ToolMessage;
        });

        const aiAnswer: AIMessage | null = answerContentText ? {
            type: "ai",
            content: answerContentText,
            calledTools: calledToolsMessage
        } : null;

        const answer: (AIMessage | ToolMessage)[] = [
            ...(aiAnswer ? [aiAnswer] : []),
            ...calledToolsMessage
        ];

        return {
            messages: [
                // Standalone messages
                ...this.config.messages,
                // AI answer
                ...answer
            ],
            answer,
            tokens: {
                input: response.usage?.input_tokens ?? 0,
                output: response.usage?.output_tokens ?? 0,
                reasoning: response.usage?.output_tokens_details?.reasoning_tokens ?? 0
            }
        };
    }

    private async *streamWithEvents(stream: AsyncIterable<ResponsesAPI.ResponseStreamEvent>) {
        for await (const event of stream) {
            this.emitEvent("stream", event);
            yield event;
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options: { stream: false }): Promise<LLMAnswer>;
    async invoke(options: { stream: true }): Promise<AsyncIterable<ResponsesAPI.ResponseStreamEvent>>;
    async invoke(options?: OpenAIInvokeOptions): Promise<LLMAnswer | AsyncIterable<ResponsesAPI.ResponseStreamEvent>> {
        const basePayload = this.prepareCreatePayload();

        if (options?.stream) {
            const streamPayload: ResponsesAPI.ResponseCreateParamsStreaming = {
                ...basePayload,
                stream: true
            };

            const stream = await this.openai.responses.create(streamPayload);

            return this.streamWithEvents(stream);
        }

        const responsePayload: ResponsesAPI.ResponseCreateParamsNonStreaming = {
            ...basePayload,
            stream: false
        };

        const response = await this.openai.responses.create(responsePayload);
        return this.parseResponseToAnswer(response);
    }
}