import { GraphNodeExecutionResult } from "../graph";

/**
 * Is the system prompt with instruction for the llm and agent
 * Should always be as the first message on chat given to the llm
 * Souldn't be repeat
*/
export interface SystemMessage {
    type: "system";
    content: string;
}

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

export type MessagesVariations = | UserMessage | AIMessage | ToolMessage;

export interface AgentMessagesGraphState {
    messages: MessagesVariations[];
}

export type AgentMessagesGraphNodeResult = GraphNodeExecutionResult<AgentMessagesGraphState>;
