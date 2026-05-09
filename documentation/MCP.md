# MCP (Model Context Protocol)

RavenADK includes MCP support based on the official [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) SDK.

With this integration you can:

- Connect to local MCP servers (stdio/ipc)
- Connect to remote MCP servers (sse, streamable-http/http, websocket)
- Download server tools dynamically
- Convert downloaded MCP tools into RavenADK Tool instances
- Pass those tools directly into ReActAgent
- Execute MCP tools from the ReAct tool loop automatically

## How It Works

1. Create an MCP manager instance.
2. Connect one or many MCP servers.
3. Download tools exposed by connected servers.
4. Convert downloaded tools to agent-compatible tools.
5. Pass those tools to ReActAgent in agentConfig.tools.
6. Invoke the agent. If the model picks an MCP tool, ReActAgent calls MCP under the hood.

## Step-by-Step Setup

### Step 1: Initialize MCP

```typescript
import { MCP } from "./src/agent/tools/mcpTools";

const mcp = new MCP({
	clientName: "my-raven-client",
	clientVersion: "1.0.0"
});
```

### Step 2: Connect MCP Servers

You can connect local and remote servers in one place.

```typescript
await mcp.connectMany([
	{
		serverId: "filesystem",
		serverName: "Local File Server",
		transport: {
			protocol: "stdio",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem", "./"]
		}
	},
	{
		serverId: "remote-tools",
		serverName: "Remote SSE Server",
		transport: {
			protocol: "sse",
			url: "https://example.com/mcp/sse"
		}
	}
]);
```

### Step 3: Download Tools

```typescript
await mcp.downloadToolsFromAllServers();

// Convert to RavenADK Tool[]
const mcpTools = mcp.getToolsAsAgentTools();
```

### Step 4: Pass MCP Tools to ReActAgent

```typescript
import { ReActAgent } from "./src/agent/ReAct.agent";
import { OpenAI } from "./src/models/openai";

const model = new OpenAI({
	model: "gpt-5.1",
	apiKey: process.env.OPENAI_API_KEY,
	tools: [],
	messages: []
});

const agent = new ReActAgent({
	model,
	systemPrompt: "You are a helpful assistant. Use tools when needed.",
	messages: [
		{
			type: "user",
			content: "Find files in this project and summarize structure."
		}
	],
	tools: [
		...mcpTools
	]
});

const result = await agent.invoke();
console.log(result.messages.at(-1));
```

## Full Example (Single Flow)

```typescript
import { MCP } from "./src/agent/tools/mcpTools";
import { ReActAgent } from "./src/agent/ReAct.agent";
import { OpenAI } from "./src/models/openai";

async function run() {
	const mcp = new MCP({ clientName: "demo-client", clientVersion: "1.0.0" });

	await mcp.connect({
		serverId: "filesystem",
		transport: {
			protocol: "stdio",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem", "./"]
		}
	});

	await mcp.downloadTools("filesystem");
	const mcpTools = mcp.getToolsAsAgentTools("filesystem");

	const model = new OpenAI({
		model: "gpt-5.1",
		apiKey: process.env.OPENAI_API_KEY,
		tools: [],
		messages: []
	});

	const agent = new ReActAgent({
		model,
		systemPrompt: "Use tools for real data, never invent outputs.",
		messages: [{ type: "user", content: "List files and explain what this repo contains." }],
		tools: [...mcpTools]
	});

	const result = await agent.invoke();
	console.log(result.messages.at(-1));

	await mcp.disconnectAll();
}

run().catch(console.error);
```

## Runtime Behavior in ReActAgent

When the model selects a tool:

1. ReActAgent matches the selected name in agentConfig.tools.
2. If the tool is MCP-backed, ReActAgent calls MCPTool.invokeFromMCP(...).
3. MCP manager calls the remote MCP server via callTool.
4. Output is normalized into readable text and returned to the ReAct loop.
5. The model receives tool output and continues reasoning.

## Naming Convention

Downloaded MCP tools are exposed to the agent with namespaced names:

- serverId::remoteToolName

This prevents name collisions across multiple MCP servers.

## Useful MCP Methods

- connect(serverConfig): connect one server
- connectMany(serverConfigs): connect many servers
- downloadTools(serverId): pull tools from one server
- downloadToolsFromAllServers(): pull tools from all connected servers
- getToolsAsAgentTools(serverId?): get Tool[] compatible with ReActAgent
- callTool(serverId, remoteToolName, args?): call a specific remote tool
- callToolByAgentName(agentToolName, args?): call by namespaced tool name
- disconnect(serverId): close one connection
- disconnectAll(): close all connections

## Tips

- Always call downloadTools(...) before passing tools to ReActAgent.
- Re-download tools when server capabilities change.
- If you connect many servers, use unique serverId values.


