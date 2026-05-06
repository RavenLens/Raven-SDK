import { LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { Anthropic as AnthropicStandalone } from '@anthropic-ai/sdk';
import { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { parseToolCallContentToParams, parseToolDescription } from "../agent/tools";
import { AIMessage, ToolMessage } from "../agent/state";
import * as z from "zod";

export class Anthropic implements StandardLLMShema {    
    private anthropic: AnthropicStandalone;
    baseURL?: string;
    config: LLMConfig;
    
    constructor(config: LLMConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.anthropic = new AnthropicStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL
        })
    }

    private prepareMessages(): MessageParam[] {
        return this.config.messages.map((message) => {
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

    async invoke(): Promise<LLMAnswer> {
        const completion = await this.anthropic.messages.create({
            model: this.config.model,
            max_tokens: 1024,
            messages: this.prepareMessages(),
            tools: this.prepareTools()
        });

        const answerContentText = completion.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
        const answerTools = completion.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

        const calledToolsMessage = answerTools.map((toolUse) => {
            const content = typeof toolUse.input === "string" ? toolUse.input : JSON.stringify(toolUse.input);

            return {
                type: "tool",
                tool_id: toolUse.id,
                content,
                parameters: parseToolCallContentToParams(content)
            } satisfies ToolMessage;
        });

        const aiAnswer: AIMessage | null = answerContentText
            ? {
                type: "ai",
                content: answerContentText,
                calledTools: calledToolsMessage
            }
            : null;
        const answer: (AIMessage | ToolMessage)[] = [
            ...(aiAnswer ? [aiAnswer] : []),
            ...calledToolsMessage
        ];

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
}