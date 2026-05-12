import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp";

export type MCPServerTransport =
    | {
        protocol: "stdio" | "ipc";
        command: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        stderr?: StdioServerParameters["stderr"];
    }
    | {
        protocol: "sse";
        url: string;
        options?: SSEClientTransportOptions;
    }
    | {
        protocol: "streamable-http" | "http";
        url: string;
        options?: StreamableHTTPClientTransportOptions;
    }
    | {
        protocol: "websocket" | "ws" | "wss";
        url: string;
    };

export interface MCPServerConfig {
    serverId: string;
    serverName?: string;
    transport: MCPServerTransport;
}

export interface MCPClientConfig {
    clientName?: string;
    clientVersion?: string;
    toolNameDelimiter?: string;
}

export interface MCPDownloadedTool {
    serverId: string;
    serverName?: string;
    remoteToolName: string;
    agentToolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
}
