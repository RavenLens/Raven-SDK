import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../src/agent/tools";
import { OpenAI } from "../src/models/openai";

const { openaiResponsesCreateMock, openaiCtorMock } = vi.hoisted(() => ({
    openaiResponsesCreateMock: vi.fn(),
    openaiCtorMock: vi.fn()
}));

vi.mock("openai", () => ({
    OpenAI: class {
        responses = {
            create: openaiResponsesCreateMock
        };

        constructor(config: unknown) {
            openaiCtorMock(config);
        }
    }
}));

describe("OpenAI model wrapper", () => {
    beforeEach(() => {
        openaiResponsesCreateMock.mockReset();
        openaiCtorMock.mockReset();
    });

    it("maps Raven messages/tools into Responses API payload and output", async () => {
        openaiResponsesCreateMock.mockResolvedValueOnce({
            id: "resp_1",
            created_at: 1,
            output_text: "It is 20C in Paris.",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-4.1-mini",
            object: "response",
            output: [
                {
                    type: "custom_tool_call",
                    call_id: "call_1",
                    name: "get_weather",
                    input: '{"location":"Paris"}'
                }
            ],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
                input_tokens_details: {
                    cached_tokens: 0
                },
                output_tokens_details: {
                    reasoning_tokens: 2
                }
            },
            top_p: 1,
            text: {
                format: {
                    type: "text"
                }
            },
            status: "completed"
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
        expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-4.1-mini",
                input: [
                    { role: "user", content: "What is weather in Paris?" },
                    { role: "assistant", content: "Let me check that for you." },
                    { type: "custom_tool_call_output", call_id: "call_0", output: "{}" }
                ],
                tools: [
                    {
                        type: "custom",
                        name: "get_weather",
                        description: expect.stringContaining("Get weather data for a city")
                    }
                ],
                stream: false
            })
        );

        expect(result.tokens).toStrictEqual({
            input: 11,
            output: 7,
            reasoning: 2
        });
        expect(result.answer).toStrictEqual([
            {
                type: "ai",
                content: "It is 20C in Paris.",
                calledTools: [
                    {
                        type: "tool",
                        tool_id: "call_1",
                        content: '{"location":"Paris"}',
                        parameters: { location: "Paris" }
                    }
                ]
            },
            {
                type: "tool",
                tool_id: "call_1",
                content: '{"location":"Paris"}',
                parameters: { location: "Paris" }
            }
        ]);
        expect(result.messages).toHaveLength(5);
    });

    it("returns a stream when invoke is called with stream: true and emits stream events", async () => {
        const streamEvents = [
            {
                type: "response.created",
                sequence_number: 1,
                response: {
                    id: "resp_stream_1"
                }
            },
            {
                type: "response.completed",
                sequence_number: 2,
                response: {
                    id: "resp_stream_1"
                }
            }
        ];

        openaiResponsesCreateMock.mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const model = new OpenAI({
            model: "gpt-5.5",
            apiKey: "test-key",
            tools: [],
            messages: [
                { type: "user", content: "Say 'double bubble bath' ten times fast." }
            ]
        });

        const emittedEvents: unknown[] = [];
        model.onEvent("stream", (event) => {
            emittedEvents.push(event);
        });

        const stream = await model.invoke({ stream: true });
        const iteratedEvents: unknown[] = [];

        for await (const event of stream) {
            iteratedEvents.push(event);
        }

        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-5.5",
                input: [
                    {
                        role: "user",
                        content: "Say 'double bubble bath' ten times fast."
                    }
                ],
                stream: true
            })
        );
        expect(iteratedEvents).toStrictEqual(streamEvents);
        expect(emittedEvents).toStrictEqual(streamEvents);
    });
});
