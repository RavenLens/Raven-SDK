import { ChatCompletionAssistantMessageParam, ChatCompletionCustomTool, ChatCompletionToolMessageParam, ChatCompletionUserMessageParam } from "openai/resources";
import { LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { OpenAI as OpenAIStandalone } from 'openai';
import { parseToolCallContentToParams, parseToolDescription } from "../agent/tools";
import { AIMessage, ToolMessage } from "../agent/state";

/**
 * Wrapper for OpenAI for RavenADK
*/
export class OpenAI implements StandardLLMShema {    
    private openai: OpenAIStandalone;
    config: LLMConfig;
    baseURL?: string;

    constructor(config: LLMConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.openai = new OpenAIStandalone({
            apiKey: this.config.apiKey,
            baseURL: baseURL
        })
    }

    /** Parse messages and return in llm compilant format */
    private prepareMessages() {
        return this.config.messages.map((message => { // Parse messages to openai compatible format
            switch(message.type) {
                case "user":
                    return {
                        role: "user",
                        content: message.content
                    } satisfies ChatCompletionUserMessageParam
                case "ai":
                    return {
                        role: "assistant",
                        content: message.content,
                        audio: message.audioInput
                    } satisfies ChatCompletionAssistantMessageParam
                case "tool":
                    return {
                        role: "tool",
                        tool_call_id: message.tool_id,
                        content: message.content
                    } satisfies ChatCompletionToolMessageParam
            }
        }));
    }

    private prepareTools() {
        return this.config.tools.map(tool => {
            return {
                type: "custom",
                custom: {
                    name: tool.toolConfig.toolName,
                    description: parseToolDescription(tool.toolConfig)
                }
            }
        }) satisfies ChatCompletionCustomTool[]
    }
    
    async invoke(): Promise<LLMAnswer> {
        const chatCompletion = await this.openai.chat.completions.create({
            model: this.config.model,
            messages: this.prepareMessages(),
            tools: this.prepareTools()
        });

        // Retrive output
        const { message } = chatCompletion.choices[0];

        const answerContentText = message.content;
        const answerContentAudio = message.audio;
        const answerTools = message.tool_calls;

        // Map output for answer
        const calledToolsMessage = answerTools?.map(tool => {
                if (tool.type === "custom") {
                    return {
                        type: "tool",
                        tool_id: tool.custom.name ?? tool.id,
                        content: tool.custom.input,
                        parameters: parseToolCallContentToParams(tool.custom.input)
                    } satisfies ToolMessage;
                }

                return undefined;
            })
            .filter((value): value is ToolMessage => value !== undefined);
        const aiAnswer: AIMessage | null = answerContentText || answerContentAudio ? {
            type: "ai",
            content: answerContentText,
            audioOutput: answerContentAudio,
            calledTools: calledToolsMessage
        } : null;
        const answer: (AIMessage | ToolMessage)[] = [
            ...(aiAnswer ? [aiAnswer] : []),
            ...(calledToolsMessage ?? [])
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
                input: chatCompletion.usage?.prompt_tokens ?? 0,
                output: chatCompletion.usage?.completion_tokens ?? 0,
                reasoning: 0
            }
        }
    }
}