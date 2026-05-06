// TODO: Make this compilant with OpenAI and Anthropic api / Add Custom model definition to allo user to hook custom model providers

import { AIMessage, MessagesVariations, ToolMessage } from "../agent/state";
import { Tool } from "../agent/tools";

interface LLMConfig {
    model: string;
    weight?: number;
    tools: Tool<any, any>[];
    messages: MessagesVariations[]
}

interface LLMAnswer {
    /** Set with all messages llm got and the answer as the last message */
    messages: MessagesVariations[];
    /** Is only the answer message for the model */
    answer: AIMessage | ToolMessage;
    tokens: {
        input: number;
        output: number;
        /** If not reasoning the value = 0 */
        reasoning: number;
    }
}

export interface StandardLLMShema {
    config: LLMConfig;
    invoke(): Promise<LLMAnswer>;
}

/** Use to execute action with OpenAI API compatible models */
export class OpenAIApiLLM implements StandardLLMShema {    
    config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
    }

    invoke(): Promise<LLMAnswer> {
        
    }
}

export class AnthropicAIApiLLM implements StandardLLMShema {    
    config: LLMConfig
    
    constructor(config: LLMConfig) {
        this.config = config;
    }

    invoke(): Promise<LLMAnswer> {
        
    }
}

type LLMLogic = () => void;
export class CustomLLM implements StandardLLMShema {
    config: LLMConfig;
    llmLogic: LLMLogic;
    
    constructor(config: LLMConfig, llmLogic: LLMLogic) {
        this.config = config;
        this.llmLogic = llmLogic;
    }

    invoke(): Promise<LLMAnswer> {

    }
}
