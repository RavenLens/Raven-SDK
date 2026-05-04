// TODO: Make this compilant with OpenAI and Anthropic api / Add Custom model definition to allo user to hook custom model providers

/** Use to execute action with OpenAI API compatible models */
export class OpenAIApiLLM {    
    constructor() {
        
    }
}

export class AnthropicAIApiLLM {    
    constructor() {
        
    }
}

export interface CustomLLMConfig {

}

type LLMLogic = () => void;
export class CustomLLM {
    llmLogic: LLMLogic;
    
    constructor(llmLogic: LLMLogic) {
        this.llmLogic = llmLogic;
    }

    invoke() {

    }
}
