import { ChatCompletionAssistantMessageParam, ChatCompletionAudio } from "openai/resources.js";
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

/** Is the ready ai answer */
export interface AIMessage {
    type: "ai";
    content?: string | null;
    audioInput?: ChatCompletionAssistantMessageParam.Audio | null;
    audioOutput?: ChatCompletionAudio | null;
    /** Attached when ai had in message the tool call */
    calledTools?: ToolMessage[];
}

/** It's the thinking process showcase -> included only for the thinking models */
export interface ReasoningMessage {
    type: "thinking";
    /** Thoughts content */
    content: string;
}

/** Is the tool usage answer */
export interface ToolMessage {
    type: "tool";
    /** Otherwise the tool name for RavenADK specified tools */
    tool_id: string;
    /**
     * The contents of the tool message from the LLM call
    */
    content: string;
    /**
     * Tool parameters are retrived by parsing the `content` property to the object
     * When parse operation wasn't possible the property has assigned null
     */
    parameters: Record<string, any> | null;
    /** Available when tool has prompted out the output -> Agent will reason atop of it */
    toolOutput?: string;
}

export type MessagesVariations = ReasoningMessage | UserMessage | AIMessage | ToolMessage;

export interface AgentMessagesGraphState {
    messages: MessagesVariations[];
}

export type AgentMessagesGraphNodeResult = GraphNodeExecutionResult<AgentMessagesGraphState>;
