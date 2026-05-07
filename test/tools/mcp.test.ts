import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MCP, MCPTool } from "../../src/agent/tools/mcpTools";

describe("mcpTools.ts", () => {
	it("connects to a real MCP stdio server, downloads tools, and executes a tool", async () => {
		const mcp = new MCP({
			clientName: "raven-test-client",
			clientVersion: "1.0.0"
		});

		const serverScriptPath = resolve(process.cwd(), "test/tools/fixtures/mcp-stdio-server.cjs");

		await mcp.connect({
			serverId: "local-fixture",
			serverName: "Local Fixture MCP",
			transport: {
				protocol: "stdio",
				command: process.execPath,
				args: [serverScriptPath]
			}
		});

		const downloaded = await mcp.downloadTools("local-fixture");
		expect(downloaded.length).toBeGreaterThanOrEqual(3);

		const agentTools = mcp.getToolsAsAgentTools("local-fixture");
		expect(agentTools.length).toBe(downloaded.length);

		const echoTool = downloaded.find((entry) => entry.remoteToolName === "echo_text");
		expect(echoTool).toBeTruthy();
		expect(echoTool?.agentToolName).toContain("local-fixture::echo_text");

		const output = await mcp.callTool("local-fixture", "echo_text", { text: "hello" });
		expect(output).toContain("echo:hello");

		await mcp.disconnectAll();
	});

	it("executes downloaded MCP tool through MCPTool wrapper methods", async () => {
		const mcp = new MCP();
		const serverScriptPath = resolve(process.cwd(), "test/tools/fixtures/mcp-stdio-server.cjs");

		await mcp.connect({
			serverId: "wrapper-fixture",
			transport: {
				protocol: "stdio",
				command: process.execPath,
				args: [serverScriptPath]
			}
		});

		await mcp.downloadTools("wrapper-fixture");
		const tools = mcp.getToolsAsAgentTools("wrapper-fixture");
		const wrappedEcho = tools.find((entry) => entry.remoteToolName === "echo_text");

		expect(wrappedEcho).toBeInstanceOf(MCPTool);

		const invokeFromMCPResult = await wrappedEcho!.invokeFromMCP({ text: "from-wrapper" });
		expect(invokeFromMCPResult).toContain("echo:from-wrapper");

		const invokeResult = await wrappedEcho!.invoke({ text: "invoke-call" });
		expect(invokeResult).toContain("echo:invoke-call");

		await mcp.disconnectAll();
	});

	it("formats structured content and error responses from real MCP tools", async () => {
		const mcp = new MCP();
		const serverScriptPath = resolve(process.cwd(), "test/tools/fixtures/mcp-stdio-server.cjs");

		await mcp.connect({
			serverId: "format-fixture",
			transport: {
				protocol: "stdio",
				command: process.execPath,
				args: [serverScriptPath]
			}
		});

		await mcp.downloadTools("format-fixture");

		const structuredResult = await mcp.callTool("format-fixture", "structured_report", { value: 7 });
		expect(structuredResult).toContain("structured-ok");
		expect(structuredResult).toContain("Structured output");
		expect(structuredResult).toContain("\"doubled\": 14");

		const errorResult = await mcp.callTool("format-fixture", "fail_with_message", { reason: "boom" });
		expect(errorResult).toContain("MCP tool returned an error");
		expect(errorResult).toContain("failure:boom");

		await mcp.disconnectAll();
	});

	it("rejects empty server id", async () => {
		const mcp = new MCP();

		await expect(
			mcp.connect({
				serverId: "   ",
				transport: {
					protocol: "stdio",
					command: process.execPath,
					args: ["-e", "process.stdin.resume()"]
				}
			})
		).rejects.toThrow("MCP serverId cannot be empty");
	});

	it("fails when calling an unknown downloaded tool name", async () => {
		const mcp = new MCP();
		const serverScriptPath = resolve(process.cwd(), "test/tools/fixtures/mcp-stdio-server.cjs");

		await mcp.connect({
			serverId: "unknown-tool-fixture",
			transport: {
				protocol: "stdio",
				command: process.execPath,
				args: [serverScriptPath]
			}
		});

		await mcp.downloadTools("unknown-tool-fixture");

		await expect(
			mcp.callTool("unknown-tool-fixture", "missing_tool", {})
		).rejects.toThrow("is not downloaded");

		await mcp.disconnectAll();
	});
});
