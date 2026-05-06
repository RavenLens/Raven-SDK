import { LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";

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
