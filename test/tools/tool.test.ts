import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
	Tool,
	parseToolCallContentToParams,
	parseToolDescription,
	tool
} from "../../src/agent/tools/tools";

describe("tools.ts", () => {
	it("builds a Tool via helper and invokes logic", async () => {
		const weatherTool = tool(
			({ location }) => `weather:${location}`,
			{
				toolName: "get_weather",
				toolDescription: "Get weather for a location",
				toolArguments: z.object({
					location: z.string()
				})
			}
		);

		const result = await weatherTool.invoke({ location: "Warsaw" });

		expect(weatherTool).toBeInstanceOf(Tool);
		expect(result).toBe("weather:Warsaw");
	});

	it("supports async tool logic", async () => {
		const asyncTool = new Tool(
			async ({ value }: { value: string }) => {
				return `async:${value}`;
			},
			{
				toolName: "async_tool",
				toolDescription: "Asynchronous tool",
				toolArguments: z.object({
					value: z.string()
				})
			}
		);

		const result = await asyncTool.invoke({ value: "ok" });
		expect(result).toBe("async:ok");
	});

	it("returns fallback error text when tool runtime does not return a string", async () => {
		const badRuntimeTool = new Tool(
			(() => ({ unexpected: true })) as unknown as (argsObj: { probe: string }) => string,
			{
				toolName: "bad_runtime",
				toolDescription: "Returns a non-string at runtime",
				toolArguments: z.object({
					probe: z.string()
				})
			}
		);

		const result = await badRuntimeTool.invoke({ probe: "x" });
		expect(result).toBe("Tool result isn't string. What is required");
	});

	it("parses valid tool call JSON input", () => {
		const parsed = parseToolCallContentToParams('{"city":"London","units":"metric"}');
		expect(parsed).toEqual({ city: "London", units: "metric" });
	});

	it("returns null for invalid tool call JSON input", () => {
		const parsed = parseToolCallContentToParams("{invalid-json");
		expect(parsed).toBeNull();
	});

	it("creates human-readable tool description from schema", () => {
		const description = parseToolDescription({
			toolName: "describe_weather",
			toolDescription: "Describe weather conditions",
			toolArguments: z.object({
				location: z.string(),
				includeWind: z.boolean()
			}),
			toolOutputSchema: z.object({
				summary: z.string(),
				temperature: z.number()
			})
		});

		expect(description).toContain("Description of tool");
		expect(description).toContain("Describe weather conditions");
		expect(description).toContain("Tool has to take arguments follows this zod schema");
		expect(description).toContain("Tool from logic wraps your response is going to return such result");
	});
});
