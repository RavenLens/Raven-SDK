import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAI } from "../src/models/openai";
import { AIMessage } from "../src/agent/state";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("OpenAI structured output integration", () => {
    it("returns parsed structuredOutput from the live API", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Return a JSON object with city and country for Paris, France."
                }
            ]
        });

        const schema = z.object({
            city: z.string(),
            country: z.string()
        });

        const result = await model.invokeStructuredOutput(schema);
        const structuredOutput = schema.parse((result.answer[0] as AIMessage).structuredOutput);

        expect(result.answer[0].type).toBe("ai");
        expect(structuredOutput.city.toLowerCase()).toContain("paris");
        expect(structuredOutput.country.toLowerCase()).toContain("france");
    }, 60000);
});