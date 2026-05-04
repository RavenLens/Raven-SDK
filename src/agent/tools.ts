import * as z from "zod";

type ToolLogic<ToolLogicArgs extends z.ZodObject> = (argsObj: z.infer<ToolLogicArgs>) => Promise<string> | string;

interface ToolConfig<
    ToolLogicArgs extends z.ZodObject,
    ToolOutputSchema extends z.ZodObject
> {
    toolName: string;
    toolDescription: string;
    /** Specify what a argument has to take the tool logic function */
    toolArguments: ToolLogicArgs;
    /** Describe object will be stringified by the logic */
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

/** Use to define agent tool */
export function tool<
    ToolLogicArgs extends z.ZodObject,
    ToolOutputSchema extends z.ZodObject
>(toolLogic: ToolLogic<ToolLogicArgs>, toolConfig: ToolConfig<ToolLogicArgs, ToolOutputSchema>) {
    return new Tool(toolLogic, toolConfig);
};
