import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, type SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    StreamableHTTPClientTransport,
    type StreamableHTTPClientTransportOptions
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as z from "zod";
import { Tool } from "./tools";

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

interface MCPServerSession {
    config: MCPServerConfig;
    client: Client;
    transport: Transport;
    connected: boolean;
    toolsByAgentName: Map<string, MCPDownloadedTool>;
    toolsByRemoteName: Map<string, MCPDownloadedTool>;
}

interface MCPToolCallResult {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    toolResult?: unknown;
    isError?: boolean;
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function normalizeText(value: unknown): string {
    const text = stringifyUnknown(value).trim();
    return text.length ? text : "(empty)";
}

function parseMCPContentBlock(contentBlock: unknown): string {
    if (!contentBlock || typeof contentBlock !== "object") {
        return normalizeText(contentBlock);
    }

    const block = contentBlock as Record<string, unknown>;
    const blockType = String(block.type ?? "unknown");

    if (blockType === "text") {
        return normalizeText(block.text);
    }

    if (blockType === "resource") {
        const resource = (block.resource ?? {}) as Record<string, unknown>;
        const uri = normalizeText(resource.uri ?? "unknown://resource");

        if (typeof resource.text === "string") {
            return `Resource ${uri}:\n${resource.text}`;
        }

        if (typeof resource.blob === "string") {
            return `Resource ${uri}: [binary payload omitted]`;
        }

        return `Resource ${uri}: ${normalizeText(resource)}`;
    }

    if (blockType === "resource_link") {
        const name = normalizeText(block.name ?? "Unnamed resource");
        const uri = normalizeText(block.uri ?? "unknown://resource");
        return `Resource link ${name}: ${uri}`;
    }

    if (blockType === "image") {
        const mimeType = normalizeText(block.mimeType ?? "unknown mime type");
        return `[image content: ${mimeType}]`;
    }

    if (blockType === "audio") {
        const mimeType = normalizeText(block.mimeType ?? "unknown mime type");
        return `[audio content: ${mimeType}]`;
    }

    return normalizeText(block);
}

function formatMCPToolResult(toolResult: MCPToolCallResult): string {
    const sections: string[] = [];

    if (Array.isArray(toolResult.content) && toolResult.content.length > 0) {
        const parsedContent = toolResult.content
            .map(parseMCPContentBlock)
            .filter((entry) => entry.trim().length > 0)
            .join("\n\n");

        if (parsedContent.trim().length > 0) {
            sections.push(parsedContent);
        }
    }

    if (toolResult.structuredContent !== undefined) {
        sections.push(`Structured output:\n${stringifyUnknown(toolResult.structuredContent)}`);
    }

    if (toolResult.toolResult !== undefined) {
        sections.push(normalizeText(toolResult.toolResult));
    }

    const merged = sections.filter(Boolean).join("\n\n").trim();

    if (!merged.length) {
        return "MCP tool returned no readable output.";
    }

    if (toolResult.isError) {
        return `MCP tool returned an error:\n${merged}`;
    }

    return merged;
}

function normalizeToolNameSegment(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_:\-\.]/g, "_");
}

export class MCPTool extends Tool<any, any> {
    readonly isMCPTool = true;
    readonly serverId: string;
    readonly remoteToolName: string;

    private readonly mcp: MCP;

    constructor(mcp: MCP, downloadedTool: MCPDownloadedTool) {
        super(
            async (argsObj) => mcp.callToolByAgentName(downloadedTool.agentToolName, argsObj as Record<string, unknown>),
            {
                toolName: downloadedTool.agentToolName,
                toolDescription: [
                    `MCP server: ${downloadedTool.serverName ?? downloadedTool.serverId}`,
                    `Remote MCP tool name: ${downloadedTool.remoteToolName}`,
                    downloadedTool.description,
                    `Input schema: ${stringifyUnknown(downloadedTool.inputSchema)}`,
                    downloadedTool.outputSchema ? `Output schema: ${stringifyUnknown(downloadedTool.outputSchema)}` : ""
                ]
                    .filter((line) => line && line.trim().length > 0)
                    .join("\n"),
                // The exact JSON schema is described in toolDescription. Runtime stays permissive.
                toolArguments: z.object({}).passthrough()
            }
        );

        this.mcp = mcp;
        this.serverId = downloadedTool.serverId;
        this.remoteToolName = downloadedTool.remoteToolName;
    }

    async invokeFromMCP(args: Record<string, unknown>): Promise<string> {
        return this.mcp.callTool(this.serverId, this.remoteToolName, args);
    }
}

export class MCP {
    private readonly config: Required<MCPClientConfig>;
    private readonly servers = new Map<string, MCPServerSession>();
    private readonly toolsByAgentName = new Map<string, MCPDownloadedTool>();

    constructor(config?: MCPClientConfig) {
        this.config = {
            clientName: config?.clientName ?? "raven-adk-mcp-client",
            clientVersion: config?.clientVersion ?? "1.0.0",
            toolNameDelimiter: config?.toolNameDelimiter ?? "::"
        };
    }

    private createTransport(transportConfig: MCPServerTransport): Transport {
        switch (transportConfig.protocol) {
            case "stdio":
            case "ipc":
                return new StdioClientTransport({
                    command: transportConfig.command,
                    args: transportConfig.args,
                    env: transportConfig.env,
                    cwd: transportConfig.cwd,
                    stderr: transportConfig.stderr
                });
            case "sse":
                return new SSEClientTransport(new URL(transportConfig.url), transportConfig.options);
            case "streamable-http":
            case "http":
                return new StreamableHTTPClientTransport(new URL(transportConfig.url), transportConfig.options);
            case "websocket":
            case "ws":
            case "wss":
                return new WebSocketClientTransport(new URL(transportConfig.url));
            default:
                throw new Error(`Unsupported MCP transport protocol: ${(transportConfig as { protocol?: string }).protocol ?? "unknown"}`);
        }
    }

    private makeAgentToolName(serverId: string, remoteToolName: string): string {
        const normalizedServerId = normalizeToolNameSegment(serverId);
        const normalizedRemoteName = normalizeToolNameSegment(remoteToolName);
        return `${normalizedServerId}${this.config.toolNameDelimiter}${normalizedRemoteName}`;
    }

    private getServerSession(serverId: string): MCPServerSession {
        const session = this.servers.get(serverId);

        if (!session || !session.connected) {
            throw new Error(`MCP server '${serverId}' is not connected.`);
        }

        return session;
    }

    async connect(serverConfig: MCPServerConfig): Promise<void> {
        if (!serverConfig.serverId.trim()) {
            throw new Error("MCP serverId cannot be empty.");
        }

        if (this.servers.has(serverConfig.serverId)) {
            await this.disconnect(serverConfig.serverId);
        }

        const client = new Client(
            {
                name: this.config.clientName,
                version: this.config.clientVersion
            },
            {
                capabilities: {}
            }
        );
        const transport = this.createTransport(serverConfig.transport);

        await client.connect(transport);

        this.servers.set(serverConfig.serverId, {
            config: serverConfig,
            client,
            transport,
            connected: true,
            toolsByAgentName: new Map(),
            toolsByRemoteName: new Map()
        });
    }

    async connectMany(serverConfigs: MCPServerConfig[]): Promise<void> {
        for (const serverConfig of serverConfigs) {
            await this.connect(serverConfig);
        }
    }

    async disconnect(serverId: string): Promise<void> {
        const session = this.servers.get(serverId);

        if (!session) {
            return;
        }

        session.connected = false;

        session.toolsByAgentName.forEach((tool) => {
            this.toolsByAgentName.delete(tool.agentToolName);
        });

        session.toolsByAgentName.clear();
        session.toolsByRemoteName.clear();

        try {
            await session.client.close();
        } finally {
            this.servers.delete(serverId);
        }
    }

    async disconnectAll(): Promise<void> {
        const connectedServerIds: string[] = [];
        this.servers.forEach((_, serverId) => {
            connectedServerIds.push(serverId);
        });

        for (const serverId of connectedServerIds) {
            await this.disconnect(serverId);
        }
    }

    async downloadTools(serverId: string): Promise<MCPDownloadedTool[]> {
        const session = this.getServerSession(serverId);
        const downloadedTools: MCPDownloadedTool[] = [];

        let cursor: string | undefined;

        do {
            const response = await session.client.listTools(cursor ? { cursor } : undefined);

            for (const remoteTool of response.tools) {
                const remoteName = String(remoteTool.name);
                const agentToolName = this.makeAgentToolName(serverId, remoteName);
                const downloadedTool: MCPDownloadedTool = {
                    serverId,
                    serverName: session.config.serverName,
                    remoteToolName: remoteName,
                    agentToolName,
                    description: remoteTool.description ?? "MCP tool without description.",
                    inputSchema: remoteTool.inputSchema ?? {},
                    outputSchema: remoteTool.outputSchema
                };

                session.toolsByAgentName.set(agentToolName, downloadedTool);
                session.toolsByRemoteName.set(remoteName, downloadedTool);
                this.toolsByAgentName.set(agentToolName, downloadedTool);
                downloadedTools.push(downloadedTool);
            }

            cursor = response.nextCursor;
        } while (cursor);

        return downloadedTools;
    }

    async downloadToolsFromAllServers(): Promise<MCPDownloadedTool[]> {
        const allTools: MCPDownloadedTool[] = [];

        const serverIds: string[] = [];
        this.servers.forEach((_, serverId) => {
            serverIds.push(serverId);
        });

        for (const serverId of serverIds) {
            const downloaded = await this.downloadTools(serverId);
            allTools.push(...downloaded);
        }

        return allTools;
    }

    getDownloadedTools(serverId?: string): MCPDownloadedTool[] {
        if (serverId) {
            const session = this.getServerSession(serverId);
            const tools: MCPDownloadedTool[] = [];
            session.toolsByAgentName.forEach((tool) => {
                tools.push(tool);
            });
            return tools;
        }

        const tools: MCPDownloadedTool[] = [];
        this.toolsByAgentName.forEach((tool) => {
            tools.push(tool);
        });
        return tools;
    }

    getToolsAsAgentTools(serverId?: string): MCPTool[] {
        return this.getDownloadedTools(serverId).map((downloadedTool) => new MCPTool(this, downloadedTool));
    }

    async callTool(serverId: string, remoteToolName: string, args?: Record<string, unknown>): Promise<string> {
        const session = this.getServerSession(serverId);

        const tool = session.toolsByRemoteName.get(remoteToolName);
        if (!tool) {
            throw new Error(
                `MCP tool '${remoteToolName}' is not downloaded for server '${serverId}'. Run downloadTools('${serverId}') first.`
            );
        }

        const result = await session.client.callTool({
            name: remoteToolName,
            arguments: args ?? {}
        });

        return formatMCPToolResult(result as MCPToolCallResult);
    }

    async callToolByAgentName(agentToolName: string, args?: Record<string, unknown>): Promise<string> {
        const tool = this.toolsByAgentName.get(agentToolName);

        if (!tool) {
            throw new Error(`MCP tool '${agentToolName}' is unknown. Run downloadTools(...) and pass getToolsAsAgentTools() to agentConfig.tools.`);
        }

        return this.callTool(tool.serverId, tool.remoteToolName, args);
    }
}
