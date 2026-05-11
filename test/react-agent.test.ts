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
        invoke: vi.fn(async () => {
            const aiMessage = {
                type: "ai" as const,
                content: "I have gathered all the information needed."
            };
            return {
                messages: [...(model.config.messages ?? []), aiMessage],
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