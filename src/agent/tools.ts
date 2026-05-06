import * as z from "zod";

type ToolLogic<ToolLogicArgs extends z.ZodObject> = (argsObj: z.infer<ToolLogicArgs>) => Promise<string> | string;

export interface ToolConfig<
    ToolLogicArgs extends z.ZodObject,
    ToolOutputSchema extends z.ZodObject
> {
    toolName: string;
    toolDescription: string;
    /** Specify what a argument has to take the tool logic function */
    toolArguments: ToolLogicArgs;
    /**
     * Describe object will be stringified by the logic
     * If not specified tool will not give llm information about output of the tool
    */
    toolOutputSchema?: ToolOutputSchema;
}

export class Tool<ToolArgs extends z.ZodObject, ToolOutputSchema extends z.ZodObject> {
    toolLogic: ToolLogic<ToolArgs>;
    toolConfig: ToolConfig<ToolArgs, ToolOutputSchema>;
    
    constructor(toolLogic: ToolLogic<ToolArgs>, toolConfig: ToolConfig<ToolArgs, ToolOutputSchema>) {
        this.toolLogic = toolLogic;
        this.toolConfig = toolConfig;
    }

    async invoke(args: z.infer<ToolArgs>) {
        const result = await this.toolLogic(args);

        if (typeof result !== "string") {
            const errMsg = "Tool result isn't string. What is required";
            console.error(errMsg);
            return errMsg
        }
        
        return result;
    }
}

export function parseToolCallContentToParams(toolCallInputContent: string): Record<string, any> | null {
    try {
        const parsedContent = JSON.parse(toolCallInputContent);
        return parsedContent;
    }
    catch(err) {
        return null;
    }
}

export function parseToolDescription(toolConfig: ToolConfig<any, any>): string {
        return `
Description of tool: "${toolConfig.toolDescription}"
Tool has to take arguments follows this zod schema: "${z.toJSONSchema(toolConfig.toolArguments)}"
${toolConfig.toolOutputSchema ? `Tool from logic wraps your response is going to return such result: ${z.toJSONSchema(toolConfig.toolOutputSchema)}` : ""}
        `
}

/** Use to define agent tool */
export function tool<
    ToolLogicArgs extends z.ZodObject,
    ToolOutputSchema extends z.ZodObject
>(toolLogic: ToolLogic<ToolLogicArgs>, toolConfig: ToolConfig<ToolLogicArgs, ToolOutputSchema>) {
    return new Tool(toolLogic, toolConfig);
};
