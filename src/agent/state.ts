import { GraphNodeExecutionResult } from "../graph";

export interface UserMessage {
    type: "user";
    content: string;
}

export interface AIMessage {
    type: "ai";
    content: string;
}

export interface ToolMessage {
    type: "tool";
    tool_name: string;
    parameters: Record<string, any>;
    /** Available when tool has prompted out the output -> Agent will reason atop of it */
    toolOutput?: string;
}

export type MessagesVariations = UserMessage | AIMessage | ToolMessage;

export interface AgentMessagesGraphState {
    messages: MessagesVariations[];
}

export type AgentMessagesGraphNodeResult = GraphNodeExecutionResult<AgentMessagesGraphState>;
