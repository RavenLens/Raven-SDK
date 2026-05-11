# Structured Output

Structured output lets you ask the model to respond with a **typed, validated JSON object** instead of free-form text. You define the shape with a [Zod](https://zod.dev) schema, call `invokeStructuredOutput`, and get back a fully parsed, schema-validated value attached directly to the AI message.

All three LLM wrappers (`OpenAI`, `Anthropic`, `RunPod`) expose the same method, and `ReActAgent` exposes it at the agent level so the entire ReAct loop runs first and the structured extraction happens at the very end.

---

## Using structured output with LLM wrappers

The method signature is identical across all three wrappers:

```ts
invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number): Promise<LLMAnswer>
```

| Parameter | Type | Description |
|---|---|---|
| `schema` | `z.ZodTypeAny` | The Zod schema the response must conform to. |
| `maxRecallTries` | `number` (optional) | How many **extra** attempts to make if the model returns invalid JSON or a schema mismatch. Defaults to `3`. |

The returned `LLMAnswer` is identical to a normal `invoke()` call, except the AI message inside `answer` and `messages` will have a `structuredOutput` property carrying the parsed, validated value.

### OpenAI

```ts
import { OpenAI } from "raven-adk";
import { z } from "zod";

const model = new OpenAI({
    model: "gpt-4.1-mini",
    apiKey: process.env.OPENAI_API_KEY!,
    messages: [
        { type: "user", content: "Where is the Eiffel Tower? Answer in JSON." }
    ]
});

const schema = z.object({
    city: z.string(),
    country: z.string()
});

const result = await model.invokeStructuredOutput(schema);

// The parsed object is on the AI message
const aiMessage = result.answer.find(m => m.type === "ai")!;
console.log(aiMessage.structuredOutput);
// → { city: "Paris", country: "France" }
```

### Anthropic

```ts
import { Anthropic } from "raven-adk";
import { z } from "zod";

const model = new Anthropic({
    model: "claude-opus-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    messages: [
        { type: "user", content: "List the planets of our solar system as JSON." }
    ]
});

const schema = z.object({
    planets: z.array(z.string())
});

const result = await model.invokeStructuredOutput(schema, 5);
const aiMessage = result.answer.find(m => m.type === "ai")!;
console.log(aiMessage.structuredOutput);
// → { planets: ["Mercury", "Venus", "Earth", ...] }
```

### RunPod

```ts
import { RunPod } from "raven-adk";
import { z } from "zod";

const model = new RunPod({
    model: "meta-llama/Llama-3.1-8B-Instruct",
    apiKey: process.env.RUNPOD_API_KEY!,
    endpointId: process.env.RUNPOD_ENDPOINT_ID!,
    messages: [
        { type: "user", content: "What is the capital of Japan? Respond in JSON." }
    ]
});

const schema = z.object({
    capital: z.string(),
    country: z.string()
});

const result = await model.invokeStructuredOutput(schema);
const aiMessage = result.answer.find(m => m.type === "ai")!;
console.log(aiMessage.structuredOutput);
// → { capital: "Tokyo", country: "Japan" }
```

---

## Using structured output with `ReActAgent`

`ReActAgent` exposes `invokeStructuredOutput` at the agent level. This is the recommended way to use structured output when your task involves **tools, reasoning loops, or multi-step work** — the agent runs its full ReAct loop to gather information and then produces the final structured object from everything it learned.

```ts
import { ReActAgent, OpenAI } from "raven-adk";
import { z } from "zod";

const model = new OpenAI({
    model: "gpt-5.5",
    apiKey: process.env.OPENAI_API_KEY!
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a research assistant.",
    messages: [
        {
            type: "user",
            content: "Find the boiling point and melting point of iron, then return them as JSON."
        }
    ],
    tools: [/* your tools here */],
    withConclusion: false   // disable the default text conclusion — structured output takes its place
});

const schema = z.object({
    element: z.string(),
    boilingPointCelsius: z.number(),
    meltingPointCelsius: z.number()
});

const result = await agent.invokeStructuredOutput(schema, 3);

// The last message in the transcript is the structured AI message
const lastMessage = result.messages.at(-1)!;
console.log(lastMessage.structuredOutput);
// → { element: "Iron", boilingPointCelsius: 2862, meltingPointCelsius: 1538 }
```

> **Tip — `withConclusion: false`**  
> `ReActAgent` defaults to generating a plain-text conclusion at the end of every run. When you call `invokeStructuredOutput` you almost always want to turn that off so the agent doesn't produce a text conclusion *and* then a structured one. Pass `withConclusion: false` in the agent config to skip the text conclusion entirely.

---

## How it works under the hood

### At the LLM wrapper level

When you call `invokeStructuredOutput` on `OpenAI`, `Anthropic`, or `RunPod`, the wrapper temporarily **replaces** the configured messages and tools before sending the request to the provider:

1. **Messages are replaced** with a system prompt instructing the model to return only valid JSON matching the provided schema (the schema is serialised to JSON Schema and embedded directly in the system message), followed by the original conversation messages as context.
2. **Tools are cleared** to zero — structured output calls are text-only; tool calls would interfere with JSON parsing.
3. The model is invoked normally.
4. The response is **parsed and validated** against the Zod schema. Code fences (` ```json ... ``` `) are stripped automatically before parsing.
5. On success, the parsed value is attached as `structuredOutput` on every AI message in both `answer` and `messages`.
6. The original messages and tools are **always restored** in a `finally` block, so the model's config is left exactly as it was.

### At the `ReActAgent` level

When you call `agent.invokeStructuredOutput(schema, maxRetries)`, the agent:

1. **Runs the full ReAct loop** exactly as `agent.invoke()` would — the model reasons, calls tools, processes tool results, and iterates until it reaches a natural conclusion.
2. Once the loop produces a final AI message, instead of writing a text conclusion the agent calls `concludeWithStructuredOutput` internally.
3. `concludeWithStructuredOutput` builds a **transcript** of the entire conversation (every message in order, including tool calls and their outputs), then calls `model.invokeStructuredOutput(schema, retriesCount)` using that transcript as context. This means the structured object is extracted from the *full picture* of what the agent learned — not just the last model message.
4. The resulting AI message (with `structuredOutput` populated) is appended to `this.agentConfig.messages`, so it appears at the end of `result.messages` when the call returns.

### What happens when the model can't produce valid output

If the model returns something that isn't valid JSON, or JSON that doesn't satisfy the Zod schema, the retry loop kicks in:

- The failure message is **added back to the conversation** as a user message: it describes exactly what was wrong (e.g. `"city: Required; country: Required"`).
- The model is invoked again, this time seeing its own bad output alongside the error description, giving it a chance to self-correct.
- This repeats for up to `maxRecallTries + 1` total attempts (so passing `maxRecallTries: 3` gives 4 total chances — 1 initial attempt + 3 retries).

If all attempts are exhausted without a valid response, an error is thrown:

```
Error: Unable to produce valid structured output after 4 attempt(s).
Last error: Model returned JSON that did not match the requested schema. city: Required
```

The original messages and tools are always restored on the model before the error propagates, so the agent or model instance is left in a clean state even when structured output fails.
