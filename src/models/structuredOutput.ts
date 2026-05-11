import * as z from "zod";
import { AIMessage, MessagesVariations } from "../agent/state";
import { LLMAnswer } from "./mutual";

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = [
    "Return only valid JSON that matches the requested schema.",
    "Do not wrap the response in markdown, code fences, or explanations."
].join("\n");

function createStructuredOutputMessages(
    messages: MessagesVariations[] | undefined,
    schema: z.ZodTypeAny,
    validationError?: string
): MessagesVariations[] {
    const schemaDescription = JSON.stringify(z.toJSONSchema(schema), null, 2);
    const structuredMessages: MessagesVariations[] = [
        {
            type: "system",
            content: [
                STRUCTURED_OUTPUT_SYSTEM_PROMPT,
                `JSON schema:\n${schemaDescription}`
            ].join("\n\n")
        },
        ...(messages ?? [])
    ];

    if (validationError) {
        structuredMessages.push({
            type: "user",
            content: [
                "The previous response was invalid for the requested schema.",
                `Error: ${validationError}`,
                "Return corrected JSON only."
            ].join("\n\n")
        });
    }

    return structuredMessages;
}

function extractStructuredOutputAIMessage(answer: LLMAnswer): AIMessage {
    const aiMessage = answer.answer.find((message): message is AIMessage => message.type === "ai");

    if (!aiMessage) {
        throw new Error("Structured output call did not return an AI message.");
    }

    return aiMessage;
}

function parseStructuredOutputContent(content: string, schema: z.ZodTypeAny): unknown {
    const trimmedContent = content.trim();
    const fencedMatch = trimmedContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const normalizedContent = fencedMatch ? fencedMatch[1].trim() : trimmedContent;

    const candidates = [normalizedContent];

    const firstObjectIndex = normalizedContent.indexOf("{");
    const lastObjectIndex = normalizedContent.lastIndexOf("}");

    if (firstObjectIndex !== -1 && lastObjectIndex > firstObjectIndex) {
        candidates.push(normalizedContent.slice(firstObjectIndex, lastObjectIndex + 1));
    }

    const firstArrayIndex = normalizedContent.indexOf("[");
    const lastArrayIndex = normalizedContent.lastIndexOf("]");

    if (firstArrayIndex !== -1 && lastArrayIndex > firstArrayIndex) {
        candidates.push(normalizedContent.slice(firstArrayIndex, lastArrayIndex + 1));
    }

    let parsedValue: unknown = null;
    let parseError: Error | null = null;

    for (const candidate of candidates) {
        try {
            parsedValue = JSON.parse(candidate);
            parseError = null;
            break;
        } catch (error) {
            parseError = error instanceof Error ? error : new Error(String(error));
        }
    }

    if (parseError) {
        throw new Error(`Model did not return valid JSON. ${parseError.message}`);
    }

    const validationResult = schema.safeParse(parsedValue);

    if (!validationResult.success) {
        const validationError = validationResult.error.issues
            .map((issue) => `${issue.path.length ? issue.path.join(".") : "<root>"}: ${issue.message}`)
            .join("; ");

        throw new Error(`Model returned JSON that did not match the requested schema. ${validationError}`);
    }

    return validationResult.data;
}

function attachStructuredOutput(answer: LLMAnswer, structuredOutput: unknown): LLMAnswer {
    return {
        ...answer,
        answer: answer.answer.map((message) => {
            if (message.type !== "ai") {
                return message;
            }

            return {
                ...message,
                structuredOutput
            };
        }),
        messages: answer.messages.map((message) => {
            if (message.type !== "ai") {
                return message;
            }

            return {
                ...message,
                structuredOutput
            };
        })
    };
}

export async function invokeStructuredOutputWithRetries<TTools>(params: {
    schema: z.ZodTypeAny;
    maxRecallTries?: number;
    messages: MessagesVariations[] | undefined;
    getTools: () => TTools;
    setMessages: (messages: MessagesVariations[] | undefined) => void;
    setTools: (tools: TTools) => void;
    invoke: () => Promise<LLMAnswer>;
}): Promise<LLMAnswer> {
    const originalMessages = params.messages;
    const originalTools = params.getTools();
    const maxRetries = params.maxRecallTries ?? 3;
    let lastError: Error | null = null;

    try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            params.setMessages(
                createStructuredOutputMessages(
                    originalMessages,
                    params.schema,
                    attempt > 0 && lastError ? lastError.message : undefined
                )
            );
            params.setTools([] as unknown as TTools);

            try {
                const answer = await params.invoke();
                const aiMessage = extractStructuredOutputAIMessage(answer);
                const structuredOutput = parseStructuredOutputContent(aiMessage.content ?? "", params.schema);

                return attachStructuredOutput(answer, structuredOutput);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }
    } finally {
        params.setMessages(originalMessages);
        params.setTools(originalTools);
    }

    throw new Error(
        `Unable to produce valid structured output after ${maxRetries + 1} attempt(s). Last error: ${lastError?.message ?? "Unknown error"}`
    );
}