import { AIMessage, MessagesVariations, ReasoningMessage, ToolMessage } from "../agent/state";
import { Tool } from "../agent/tools/tools";

export interface LLMConfig {
    /** The model ID for specified provider e.g: GPT-5.5 */
    model: string;
    weight?: number;
    tools?: Tool<any, any>[];
    apiKey?: string;
    /** The url to the custom provider */
    baseURL?: string;
    /** Specify here user message and the all messages are required to run the llm */
    messages?: MessagesVariations[];
}

export interface LLMAnswer {
    /** Set with all messages llm got and the answers as the last message/s */
    messages: MessagesVariations[];
    /** Are only the answer messages for this model call */
    answer: (ReasoningMessage | AIMessage | ToolMessage)[];
    tokens: {
        input: number;
        output: number;
        /** If not reasoning the value = 0 */
        reasoning: number;
    }
}

export interface InvokeOptions {
    stream?: boolean;
    /** Model will override his messages called in initialization with the specified here messages */
    messages?: MessagesVariations[];
}

export interface StandardLLMShema {
    apiName: "Anthropic" | "OpenAI" | { custom: string };
    config: LLMConfig;
    invoke(): Promise<LLMAnswer>;
}
