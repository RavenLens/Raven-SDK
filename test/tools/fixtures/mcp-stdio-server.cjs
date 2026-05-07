const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const server = new McpServer({
    name: "raven-mcp-test-server",
    version: "1.0.0"
});

server.registerTool(
    "echo_text",
    {
        description: "Echoes the provided text",
        inputSchema: {
            text: z.string()
        }
    },
    async ({ text }) => {
        return {
            content: [
                {
                    type: "text",
                    text: `echo:${text}`
                }
            ]
        };
    }
);

server.registerTool(
    "structured_report",
    {
        description: "Returns text with structured output",
        inputSchema: {
            value: z.number()
        }
    },
    async ({ value }) => {
        return {
            content: [
                {
                    type: "text",
                    text: "structured-ok"
                }
            ],
            structuredContent: {
                value,
                doubled: value * 2
            }
        };
    }
);

server.registerTool(
    "fail_with_message",
    {
        description: "Returns a tool-level error payload",
        inputSchema: {
            reason: z.string()
        }
    },
    async ({ reason }) => {
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `failure:${reason}`
                }
            ]
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error("MCP stdio test server failed:", error);
    process.exit(1);
});
