import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../src/agent/tools";
import { OpenAI } from "../src/models/openai";

const { openaiCreateMock, openaiCtorMock } = vi.hoisted(() => ({
    openaiCreateMock: vi.fn(),
    openaiCtorMock: vi.fn()
}));

vi.mock("openai", () => ({
    OpenAI: class {
        chat = {
            completions: {
                create: openaiCreateMock
            }
        };

        constructor(config: unknown) {
            openaiCtorMock(config);
        }
    }
}));

describe("OpenAI model wrapper", () => {
    beforeEach(() => {
        openaiCreateMock.mockReset();
        openaiCtorMock.mockReset();
    });

    it("maps Raven messages/tools into OpenAI payload and output", async () => {
        openaiCreateMock.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        content: "It is 20C in Paris.",
                        audio: null,
                        tool_calls: [
                            {
                                id: "call_1",
                                type: "custom",
                                custom: {
                                    name: "get_weather",
                                    input: '{"location":"Paris"}'
                                }
                            }
                        ]
                    }
                }
            ],
            usage: {
                prompt_tokens: 11,
                completion_tokens: 7
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

        const model = new OpenAI({
            model: "gpt-4.1-mini",
            apiKey: "test-key",
            tools: [weatherTool],
            messages: [
                { type: "user", content: "What is weather in Paris?" },
                { type: "ai", content: "Let me check that for you." },
                { type: "tool", tool_id: "call_0", content: "{}", parameters: {} }
            ]
        });

        const result = await model.invoke();

        expect(openaiCtorMock).toHaveBeenCalledWith({
            apiKey: "test-key",
            baseURL: undefined
        });
        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-4.1-mini",
                messages: [
                    { role: "user", content: "What is weather in Paris?" },
                    { role: "assistant", content: "Let me check that for you.", audio: undefined },
                    { role: "tool", tool_call_id: "call_0", content: "{}" }
                ],
                tools: [
                    {
                        type: "custom",
                        custom: {
                            name: "get_weather",
                            description: expect.stringContaining("Get weather data for a city")
                        }
                    }
                ]
            })
        );

        expect(result.tokens).toStrictEqual({
            input: 11,
            output: 7,
            reasoning: 0
        });
        expect(result.answer).toStrictEqual([
            {
                type: "ai",
                content: "It is 20C in Paris.",
                audioOutput: null,
                calledTools: [
                    {
                        type: "tool",
                        tool_id: "get_weather",
                        content: '{"location":"Paris"}',
                        parameters: { location: "Paris" }
                    }
                ]
            },
            {
                type: "tool",
                tool_id: "get_weather",
                content: '{"location":"Paris"}',
                parameters: { location: "Paris" }
            }
        ]);
        expect(result.messages).toHaveLength(5);
    });
});
