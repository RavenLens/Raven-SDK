import { Graph, GraphMarkers } from "../graph";
import { Anthropic } from "../models/anthropic";
import { OpenAI } from "../models/openai";
import { KnowledgeFoundation } from "./knowledge";
import { SkillsFoundation } from "./skills";
import { AgentMessagesGraphState, MessagesVariations } from "./state";
import { Tool } from "./tools";

interface ReActAgentConfig<Skills extends SkillsFoundation, Knowledge extends KnowledgeFoundation> {
    model: OpenAI | Anthropic;
    systemPrompt: string;
    messages: MessagesVariations[];
    /**
     * Skills is the set of skills the agent can use to perform some action
     * In CASCADE (https://arxiv.org/abs/2512.23880) scenario -> agent can develop his own skills
    */
    skills?: Skills;
    /**
     * It's the agent knowledge he developed for specific user session or for organization
     */
    knowledge?: Knowledge;
    tools: Tool<any, any>[];
}

interface ReActAgentEvents {
    tool_invoked: (toolName: string, toolParams: Record<string, any>) => void | Promise<void>;
    tool_executed: (toolName: string, toolParams: Record<string, any>, output: string) => void | Promise<void>;
    /** Is produced at the end of reasoning phase */
    reasoning_end: (thoughts: string) => void | Promise<void>;
    /** When agent starts to produce output */
    result_producing_start: () => void | Promise<void>;
}

interface ReActAgentInvokeResult {
    messages: MessagesVariations[];
    state: AgentMessagesGraphState;
}

export interface ReActAgentStreamChunk {
    type: "reasoning" | "output";
    content: string;
}

const REACT_SYSTEM_PROMPT = [
    "You are RavenADK ReAct agent.",
    "Follow the ReAct loop strictly:",
    "1. Reason about the task and what information is missing.",
    "2. Act by calling tools when external information or side-effects are required.",
    "3. Observe tool outputs and continue reasoning from those observations.",
    "4. Repeat Reason/Act/Observe until the task is solved or blocked.",
    "5. Provide a final answer only when enough evidence is collected.",
    "Tool usage rules:",
    "- Never invent tool outputs.",
    "- Prefer available tools over guessing.",
    "- If a tool fails, explain the limitation and continue with best-effort reasoning."
].join("\n");

/**
 * ReAct flow:
 * 1. Reason
 * 2. Make actions
 * 3. Execute tools by calling `tools_node`, then append tool outputs as messages
 * 4. Reason over tool execution results
 * 5. Produce output by completing `main_node`, then graph continues to GraphMarkers.END
 * 6. Emit events for reasoning and tool lifecycle
*/
export class ReActAgent<Skills extends SkillsFoundation, Knowledge extends KnowledgeFoundation> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    agentConfig: ReActAgentConfig<Skills, Knowledge>;

    constructor(config: ReActAgentConfig<Skills, Knowledge>) {
        this.agentConfig = config;
        this.ensureWrappedSystemPrompt();
        this.synchronizeModelConfig();

        const reactAgentGraph = new Graph<AgentMessagesGraphState>({});

        reactAgentGraph
            .addNode("main_node", async state => {
                let currentState = state;

                // Resolve tools
                if (state.callTools?.tools.length) {
                    this.agentConfig.messages = [
                        ...this.agentConfig.messages,
                        ...state.callTools.tools.map(toolMessage => ({
                            ...toolMessage,
                            content: toolMessage.toolOutput ?? toolMessage.content
                        }))
                    ];

                    const { callTools, ...stateWithoutCallTools } = state;

                    return {
                        callNode: "main_node",
                        stateUpdate: {
                            ...stateWithoutCallTools,
                            toolsOutputRetrived: true
                        }
                    };
                }

                // 
                if (state.toolsOutputRetrived) {
                    const { toolsOutputRetrived, ...stateWithoutToolFlag } = state;
                    currentState = stateWithoutToolFlag;
                }

                const modelInvoke = await this.agentConfig.model.invoke({
                    messages: this.agentConfig.messages
                });
                this.agentConfig.messages = modelInvoke.messages;

                const reasoningMessages = modelInvoke.answer
                    .filter((answerMsg): answerMsg is Extract<MessagesVariations, { type: "thinking" }> => answerMsg.type === "thinking")
                    .map((thought) => thought.content)
                    .join("\n\n")
                    .trim();

                if (reasoningMessages.length > 0) {
                    this.emitEvent("reasoning_end", reasoningMessages);
                }

                const toolAnswers = modelInvoke.answer.filter(
                    (answerMsg): answerMsg is Extract<MessagesVariations, { type: "tool" }> => answerMsg.type === "tool"
                );

                if (toolAnswers.length) {
                    return {
                        callNode: "tools_node",
                        stateUpdate: {
                            ...currentState,
                            callTools: {
                                tools: toolAnswers,
                                recentModelAnswers: modelInvoke.answer
                            }
                        }
                    };
                }

                const hasFinalOutput = modelInvoke.answer.some(
                    answerMsg => answerMsg.type === "ai" && !!answerMsg.content?.trim()
                );

                if (hasFinalOutput) {
                    this.emitEvent("result_producing_start");
                }

                return {
                    stateUpdate: currentState
                };
            })
            .addNode("tools_node", async state => {
                if (state.callTools?.tools.length) {
                    const { tools: definedTools } = this.agentConfig;
                    const definedToolsByName = new Map(
                        definedTools.map((definedTool) => [definedTool.toolConfig.toolName, definedTool])
                    );

                    const toolsStatePrepared = await Promise.all(
                        state.callTools.tools.map(async tool => {
                            const toolName = tool.tool_name ?? tool.tool_id;
                            const definedTool = definedToolsByName.get(toolName);
                            const toolParams = tool.arguments ?? {};

                            if (!definedTool) {
                                const missingToolError = `Tool couldn't be executed because tool with name "${toolName}" does not exist`;

                                return {
                                    ...tool,
                                    tool_name: toolName,
                                    toolError: missingToolError,
                                    toolOutput: missingToolError,
                                    content: missingToolError
                                };
                            }

                            this.emitEvent("tool_invoked", toolName, toolParams);

                            try {
                                const toolOutput = await definedTool.invoke(toolParams as never);
                                this.emitEvent("tool_executed", toolName, toolParams, toolOutput);

                                return {
                                    ...tool,
                                    tool_name: toolName,
                                    toolError: undefined,
                                    toolOutput,
                                    content: toolOutput
                                };
                            } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error";
                                const toolFailureOutput = `Tool "${toolName}" failed during execution: ${errorMessage}`;

                                return {
                                    ...tool,
                                    tool_name: toolName,
                                    toolError: errorMessage,
                                    toolOutput: toolFailureOutput,
                                    content: toolFailureOutput
                                };
                            }
                        })
                    );

                    return {
                        callNode: "main_node",
                        stateUpdate: {
                            ...state,
                            callTools: {
                                ...state.callTools,
                                tools: toolsStatePrepared
                            }
                        }
                    };
                }

                return {
                    callNode: "main_node",
                    stateUpdate: {
                        ...state,
                        callTools: undefined
                    }
                };
            })
            .addEdge(GraphMarkers.START, "main_node")
            .addEdge("main_node", GraphMarkers.END);

        this.AgentGraph = reactAgentGraph;
    }

    private buildWrappedSystemPrompt(userSystemPrompt: string): string {
        const cleanedUserPrompt = userSystemPrompt.trim();

        if (!cleanedUserPrompt.length) {
            return REACT_SYSTEM_PROMPT;
        }

        return `${REACT_SYSTEM_PROMPT}\n\nUser system prompt:\n${cleanedUserPrompt}`;
    }

    private ensureWrappedSystemPrompt(): void {
        const wrappedSystemPrompt = this.buildWrappedSystemPrompt(this.agentConfig.systemPrompt);
        const nonSystemMessages = this.agentConfig.messages.filter(message => message.type !== "system");

        this.agentConfig.messages = [
            {
                type: "system",
                content: wrappedSystemPrompt
            },
            ...nonSystemMessages
        ];
    }

    private synchronizeModelConfig(): void {
        this.agentConfig.model.config.tools = this.agentConfig.tools;
        this.agentConfig.model.config.messages = this.agentConfig.messages;
    }

    onEvent<EventName extends keyof ReActAgentEvents>(
        eventName: EventName,
        eventListener: ReActAgentEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof ReActAgentEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<ReActAgentEvents[EventName]>
    ) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as ReActAgentEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    async invoke(): Promise<ReActAgentInvokeResult> {
        this.ensureWrappedSystemPrompt();
        this.synchronizeModelConfig();
        this.AgentGraph.graphState = {};

        await this.AgentGraph.start();

        this.synchronizeModelConfig();

        return {
            messages: this.agentConfig.messages,
            state: this.AgentGraph.getState()
        };
    }

    async invokeStream(): Promise<AsyncIterable<ReActAgentStreamChunk>> {
        const previousLength = this.agentConfig.messages.length;
        const invocationResult = await this.invoke();

        const streamMessages = invocationResult.messages
            .slice(previousLength)
            .filter((message) => message.type === "thinking" || (message.type === "ai" && !!message.content?.trim()));

        const streamGenerator = async function* (): AsyncGenerator<ReActAgentStreamChunk> {
            for (const message of streamMessages) {
                if (message.type === "thinking") {
                    yield {
                        type: "reasoning",
                        content: message.content
                    };
                    continue;
                }

                if (message.type === "ai" && message.content) {
                    yield {
                        type: "output",
                        content: message.content
                    };
                }
            }
        };

        return streamGenerator();
    }

    public get messages() {
        return this.agentConfig.messages;
    }
}
