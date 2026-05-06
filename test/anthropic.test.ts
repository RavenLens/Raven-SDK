import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../src/agent/tools";
import { Anthropic } from "../src/models/anthropic";

const { anthropicCreateMock, anthropicCtorMock } = vi.hoisted(() => ({
    anthropicCreateMock: vi.fn(),
    anthropicCtorMock: vi.fn()
}));

vi.mock("@anthropic-ai/sdk", () => ({
    Anthropic: class {
        messages = {
            create: anthropicCreateMock
        };

        constructor(config: unknown) {
            anthropicCtorMock(config);
        }
    }
}));

describe("Anthropic model wrapper", () => {
    beforeEach(() => {
        anthropicCreateMock.mockReset();
        anthropicCtorMock.mockReset();
    });

    it("maps Raven messages/tools into Anthropic payload and output", async () => {
        anthropicCreateMock.mockResolvedValueOnce({
            content: [
                {
                    type: "text",
                    text: "I will call a weather tool."
                },
                {
                    type: "tool_use",
                    id: "toolu_1",
                    name: "get_weather",
                    input: {
                        location: "Paris"
                    },
                    caller: "direct"
                }
            ],
            usage: {
                input_tokens: 13,
                output_tokens: 8
            }
        });

        const weatherTool = tool(
            ({ location }: { location: string }) => `Weather for ${location}`,
            {
                toolName: "get_weather",
                toolDescription: "Get weather data for a city",
                toolArguments: z.object({
                    location: z.string().describe("City name")
                }),
                toolOutputSchema: z.object({
                    temperature: z.number()
                })
            }
        );

        const model = new Anthropic({
            model: "claude-3-5-haiku-20241022",
            apiKey: "test-key",
            tools: [weatherTool],
            messages: [
                { type: "user", content: "What is weather in Paris?" },
                { type: "ai", content: "Let me check that for you." },
                { type: "tool", tool_id: "toolu_prev", content: "{}", parameters: {} }
            ]
        });

        const result = await model.invoke();

        expect(anthropicCtorMock).toHaveBeenCalledWith({
            apiKey: "test-key",
            baseURL: undefined
        });
        expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
        expect(anthropicCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "claude-3-5-haiku-20241022",
                max_tokens: 1024,
                messages: [
                    { role: "user", content: "What is weather in Paris?" },
                    { role: "assistant", content: "Let me check that for you." },
                    {
                        role: "user",
                        content: [
                            {
                                type: "tool_result",
                                tool_use_id: "toolu_prev",
                                content: "{}"
                            }
                        ]
                    }
                ],
                tools: [
                    expect.objectContaining({
                        name: "get_weather",
                        description: expect.stringContaining("Get weather data for a city"),
                        input_schema: expect.objectContaining({
                            type: "object"
                        })
                    })
                ]
            })
        );

        expect(result.tokens).toStrictEqual({
            input: 13,
            output: 8,
            reasoning: 0
        });
        expect(result.answer).toStrictEqual([
            {
                type: "ai",
                content: "I will call a weather tool.",
                calledTools: [
                    {
                        type: "tool",
                        tool_id: "toolu_1",
                        content: '{"location":"Paris"}',
                        parameters: { location: "Paris" }
                    }
                ]
            },
            {
                type: "tool",
                tool_id: "toolu_1",
                content: '{"location":"Paris"}',
                parameters: { location: "Paris" }
            }
        ]);
        expect(result.messages).toHaveLength(5);
    });
});
