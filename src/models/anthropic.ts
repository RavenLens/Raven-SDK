import { LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { Anthropic as AnthropicStandalone } from '@anthropic-ai/sdk';

export class Anthropic implements StandardLLMShema {    
    private anthropic: AnthropicStandalone;
    baseURL?: string;
    config: LLMConfig;
    
    constructor(config: LLMConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.anthropic = new AnthropicStandalone({
            apiKey: this.config.apiKey,
            baseURL: baseURL
        })
    }

    invoke(): Promise<LLMAnswer> {
        
    }
}