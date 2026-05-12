import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../src/agent/ReAct.agent";

const makeModel = (structuredOutput: Record<string, string>) => {
    const model = {
        apiName: "OpenAI" as const,
        config: {
            model: "gpt-4.1-mini",
            apiKey: "test-key",
            messages: [] as any[],
            tools: [] as any[]
        },
        invoke: vi.fn(async (params: any) => {
            const currentMessages = params?.messages || model.config.messages || [];
            const aiMessage = {
                type: "ai" as const,
                content: "I have gathered all the information needed."
            };
            return {
                messages: [...currentMessages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        }),
        invokeStructuredOutput: vi.fn(async (_schema: z.ZodTypeAny, _maxRetries?: number) => {
            const aiMessage = {
                type: "ai" as const,
                content: JSON.stringify(structuredOutput),
                structuredOutput
            };
            return {
                messages: [...(model.config.messages ?? []), aiMessage],
                answer: [aiMessage],
                tokens: { input: 8, output: 4, reasoning: 0 }
            };
        })
    };
    return model;
};

describe("ReActAgent subagents", () => {
    it("can call a subagent using [[RAVEN_CALL_SUBAGENT]]", async () => {
        let callCount = 0;
        const mainModel = {
            apiName: "OpenAI" as const,
            config: {
                model: "gpt-4o",
                apiKey: "test-key",
                messages: [] as any[],
                tools: [] as any[]
            },
            invoke: vi.fn(async (params: any) => {
                const currentMessages = params?.messages || mainModel.config.messages || [];
                callCount++;
                if (callCount === 1) {
                    // First invoke, return subagent call
                    const aiMessage = {
                        type: "ai" as const,
                        content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Find information about Mars."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else {
                    // Third invoke (after subagent returns), conclude
                    const aiMessage = {
                        type: "ai" as const,
                        content: "The researcher found the info. Mars is a planet."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                }
            })
        };

        const subModel = {
            apiName: "OpenAI" as const,
            config: {
                model: "gpt-4o",
                apiKey: "test-key",
                messages: [] as any[],
                tools: [] as any[]
            },
            invoke: vi.fn(async (params: any) => {
                const currentMessages = params?.messages || subModel.config.messages || [];
                // Subagent invoke
                const aiMessage = {
                    type: "ai" as const,
                    content: "Mars is the fourth planet from the Sun."
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 20, output: 10, reasoning: 0 }
                };
            })
        };

        const agent = new ReActAgent({
            model: mainModel as any,
            systemPrompt: "You are the main agent.",
            messages: [{ type: "user", content: "Tell me about Mars." }],
            tools: [],
            withConclusion: false,
            subagents: [{
                role: "Researcher",
                roleDescription: "Searches for info",
                model: subModel as any,
                systemPrompt: "You are a researcher.",
                tools: []
            }]
        });

        const result = await agent.invoke();

        // Ensure main model was called twice (once to decide subagent, once to finalize)
        expect(mainModel.invoke).toHaveBeenCalledTimes(2);
        
        // Ensure sub model was called once (to produce its answer and conclusion since withConclusion defaults to true for subagents!)
        expect(subModel.invoke).toHaveBeenCalledTimes(2);

        // Verify state traces
        expect(result.messages.some(m => m.type === "user" && m.content === "[CALLING SUBAGENT: Researcher] Task: Find information about Mars.")).toBe(true);
        expect(result.messages.at(-1)?.content).toBe("The researcher found the info. Mars is a planet.");
        
        // Tokens should be accumulated
        // mainModel: 2 invokes = 2 * (10, 5) = (20, 10). Plus 1 conclusion invoke from main agent? Wait, main agent has withConclusion=false.
        // subagent: 1 normal invoke = (20, 10). 1 conclusion invoke = (20, 10). Total = 40, 20.
        // Total should be 20+40 = 60 input, 10+20 = 30 output.
        expect(agent.usedTokens.input).toBe(60);
        expect(agent.usedTokens.output).toBe(30);
    });
});

describe("ReActAgent structured output", () => {
    it("returns the structured output on the final AI message", async () => {
        const structuredOutput = { city: "Paris", country: "France" };
        const model = makeModel(structuredOutput);

        const agent = new ReActAgent({
            model: model as any,
            systemPrompt: "You are a structured-output agent.",
            messages: [{ type: "user", content: "Return the target city and country." }],
            tools: [],
            withConclusion: false
        });

        const schema = z.object({ city: z.string(), country: z.string() });
        const result = await agent.invokeStructuredOutput(schema, 2);

        expect(model.invokeStructuredOutput).toHaveBeenCalledWith(schema, 2);
        expect(result.messages.at(-1)).toMatchObject({
            type: "ai",
            content: JSON.stringify(structuredOutput),
            structuredOutput
        });
        expect(result.messages.some((m) => m.type === "system")).toBe(true);
        expect(result.state).toBeDefined();
    });

    it("concludeWithStructuredOutput uses retriesCount from graph state", async () => {
        const structuredOutput = { name: "Alice", age: 30 };
        const model = makeModel(structuredOutput as any);

        const agent = new ReActAgent({
            model: model as any,
            systemPrompt: "Extract structured data.",
            messages: [{ type: "user", content: "Who is the person mentioned?" }],
            tools: [],
            withConclusion: false
        });

        const schema = z.object({ name: z.string(), age: z.number() });
        const result = await agent.invokeStructuredOutput(schema, 4);

        // main_node invokes the model first for normal reasoning
        expect(model.invoke).toHaveBeenCalledOnce();

        // concludeWithStructuredOutput calls invokeStructuredOutput with the schema and retriesCount
        expect(model.invokeStructuredOutput).toHaveBeenCalledOnce();
        expect(model.invokeStructuredOutput).toHaveBeenCalledWith(schema, 4);

        // the final message carries structuredOutput
        const lastMessage = result.messages.at(-1);
        expect(lastMessage?.type).toBe("ai");
        expect((lastMessage as any).structuredOutput).toEqual(structuredOutput);
    });

    it("preserves model config after concludeWithStructuredOutput", async () => {
        const structuredOutput = { status: "done" };
        const model = makeModel(structuredOutput);

        const originalTools = [{ name: "my_tool" }] as any[];
        const agent = new ReActAgent({
            model: model as any,
            systemPrompt: "Agent with tools.",
            messages: [{ type: "user", content: "Do the thing." }],
            tools: originalTools,
            withConclusion: false
        });

        const schema = z.object({ status: z.string() });
        await agent.invokeStructuredOutput(schema, 3);

        // model config is restored to original tools after concludeWithStructuredOutput
        expect(model.config.tools).toEqual(originalTools);
    });
});