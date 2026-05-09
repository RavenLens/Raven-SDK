export type HITLToolAllowancePossibleAnswer = "allow" | "deny";

export const DEFAULT_ABC_ANSWERS_RANGE = ["a", "b", "c"];

export interface ToolUsageConfObject {
    delayMs: number;
    defaultAnswer: HITLToolAllowancePossibleAnswer;
}

export interface HITLConfigSchema {
    /**
     * Whether agent can ask user a questions
    */
    questions?: {
        /** 
         * Whether agent can ask closed questions
         * If specified object a agent can ask a questions, perhaps when is determined by the `instruction` field of agent
        */
        abcQuestion?: {
            instruction: string;
            /**
             * E.g: [a, b, c, d, e, f]
             * Default: a, b, c
            */
            maxAnswersRange?: string[];
        } | boolean;
        /** 
         * Whwther agent can ask open questions
         * If specified object a agent can ask a questions, perhaps when is determined by the `instruction` field of agent
        */
        openQuestion?: {
            instruction: string; 
        } | boolean;
    };
    /**
     * Determines whether to ask user are the tool(s) (multiple or single) allowed to use
     * Object is the set with tools and specification according to tool usage
     * Use a `delayMs` and `defaultAnswer` to specify default answer after time
    */
    toolsUsage?: Record<string, ToolUsageConfObject | true>;
}
