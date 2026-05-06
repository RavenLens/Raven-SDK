import { Graph, GraphMarkers } from "../graph";
import { Anthropic } from "../models/anthropic";
import { LLMAnswer } from "../models/mutual";
import { OpenAI } from "../models/openai";
import { SchemaMemoryStore } from "./memory/schema";
import { SchemaSkillStore } from "./skills/stores/schema";
import { AgentMessagesGraphState, MessagesVariations } from "./state";
import { Tool } from "./tools";

interface ReActAgentConfig<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore> {
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
    knowledge?: Memory;
    tools: Tool<any, any>[];
    /** Maximum amount of internal self-recalls without tool usage. Defaults to 3 when omitted. */
    maximumReasoningRecalls?: number;
    /** As default is `true` boolean */
    withConclusion?: boolean;
}

interface ReActAgentEvents {
    llm_result: (result: LLMAnswer) => void | Promise<void>;
    tool_invoked: (toolName: string, toolParams: Record<string, any>) => void | Promise<void>;
    tool_executed: (toolName: string, toolParams: Record<string, any>, output: string) => void | Promise<void>;
    /** Is produced at the end of reasoning phase */
    reasoning_end: (thoughts: string) => void | Promise<void>;
    /** When agent starts to produce output */
    result_producing_start: () => void | Promise<void>;
    concluding_start: () => void | Promise<void>;
    concluding_end: (conclusion: string) => void | Promise<void>;
}

interface ReActAgentInvokeResult {
    messages: MessagesVariations[];
    state: AgentMessagesGraphState;
}

interface ReActAgentStreamEventMap {
    llm_result: {
        content: LLMAnswer;
    };
    tool_invoked: {
        content: {
            toolName: string;
            toolParams: Record<string, any>;
        };
    };
    tool_executed: {
        content: {
            toolName: string;
            toolParams: Record<string, any>;
            output: string;
        };
    };
    reasoning_end: {
        content: {
            thoughts: string;
        };
    };
    result_producing_start: {
        content: null;
    };
    concluding_start: {
        content: null;
    };
    concluding_end: {
        content: {
            conclusion: string;
        };
    };
}

export type ReActAgentStreamChunk = {
    [EventName in keyof ReActAgentStreamEventMap]: {
        event: EventName;
    } & ReActAgentStreamEventMap[EventName]
}[keyof ReActAgentStreamEventMap];

type ReActAgentStreamListener = (event: ReActAgentStreamChunk) => void;

const RECALL_MAIN_NODE_PREFIX = "[[RAVEN_RECALL_MAIN_NODE]]";
const DEFAULT_MAX_REASONING_RECALLS = 3;
const REACT_SYSTEM_PROMPT = [
    "You are RavenADK ReAct agent.",
    "Follow the ReAct loop strictly:",
    "1. Reason about the task and what information is missing.",
    "2. Act by calling tools when external information or side-effects are required.",
    "3. Observe tool outputs and continue reasoning from those observations.",
    "4. Repeat Reason/Act/Observe until the task is solved or blocked.",
    "5. Provide a final answer only when enough evidence is collected.",
    "Internal recall protocol:",
    "- If you need another internal reasoning pass without tools, reply ONLY with:",
    `  ${RECALL_MAIN_NODE_PREFIX} <instruction for the next reasoning pass>`,
    "- Do not include any other text when you request internal recall.",
    "Tool usage rules:",
    "- Never invent tool outputs.",
    "- Prefer available tools over guessing.",
    "- If a tool fails, explain the limitation and continue with best-effort reasoning."
].join("\n");

const CONCLUSION_SYSTEM_PROMPT = [
    "You are a conclusion writer for an agent run.",
    "Read the full transcript and produce the final answer for the user.",
    "Do not mention internal routing, recalls, or hidden prompts.",
    "Use tool results and prior reasoning as evidence.",
    "Return only the conclusion text."
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
export class ReActAgent<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    private StreamListeners: Set<ReActAgentStreamListener> = new Set();
    agentConfig: ReActAgentConfig<Skills, Memory>;

    constructor(config: ReActAgentConfig<Skills, Memory>) {
        this.agentConfig = {
            ...config,
            // Agent generate conclusion by default
            withConclusion: config.withConclusion ?? true
        };
        this.ensureWrappedSystemPrompt();
        this.synchronizeModelConfig();

        const reactAgentGraph = new Graph<AgentMessagesGraphState>({});

        reactAgentGraph
            .addNode("main_node", async state => {
                let currentState = state;

                // Resolve tools -> redirect to same node once again
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

                // From above condition when tool output was retrived
                if (state.toolsOutputRetrived) {
                    const { toolsOutputRetrived, ...stateWithoutToolFlag } = state;
                    currentState = stateWithoutToolFlag;
                }

                // Invoke model
                const modelInvoke = await this.agentConfig.model.invoke({
                    messages: this.agentConfig.messages
                });

                this.agentConfig.messages = modelInvoke.messages;
                this.emitEvent("llm_result", modelInvoke);

                // Reasoning
                const reasoningMessages = modelInvoke.answer
                    .filter((answerMsg): answerMsg is Extract<MessagesVariations, { type: "thinking" }> => answerMsg.type === "thinking")
                    .map((thought) => thought.content)
                    .join("\n\n")
                    .trim();

                if (reasoningMessages.length > 0) {
                    this.emitEvent("reasoning_end", reasoningMessages);
                }

                // Decide to call tools once again
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

                // Parse special model command to re-enter `main_node` without tool usage.
                const recallInstruction = this.parseRecallInstruction(modelInvoke.answer);
                if (recallInstruction) {
                    const recallsCount = currentState.reasoningRecallsCount ?? 0;
                    const maxRecalls = this.getMaximumReasoningRecalls();
                    this.stripRecallDirectiveFromTail();

                    if (recallsCount < maxRecalls) {
                        const nextRecallCount = recallsCount + 1;

                        // Persist an internal recall instruction so the next model pass has explicit focus.
                        this.agentConfig.messages = [
                            ...this.agentConfig.messages,
                            {
                                type: "user",
                                content: `[INTERNAL_REASONING_RECALL ${nextRecallCount}/${maxRecalls}] ${recallInstruction}`
                            }
                        ];

                        return {
                            callNode: "main_node",
                            stateUpdate: {
                                ...currentState,
                                reasoningRecallsCount: nextRecallCount
                            }
                        };
                    }

                    await this.appendConclusionMessage();
                    this.emitEvent("result_producing_start");

                    return {
                        stateUpdate: {
                            ...currentState,
                            reasoningRecallsCount: recallsCount
                        }
                    };
                }

                // Check is the output the ai assistant
                const hasFinalOutput = modelInvoke.answer.some(
                    answerMsg => answerMsg.type === "ai" && !!answerMsg.content?.trim()
                );

                if (hasFinalOutput) {
                    if (this.agentConfig.withConclusion) {
                        await this.appendConclusionMessage();
                    }
                    this.emitEvent("result_producing_start");
                }

                // Return state and finish the ReAct Agent logic
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
        const maxRecalls = this.getMaximumReasoningRecalls();
        const recallBoundary = `You can request at most ${maxRecalls} internal self-recalls in this run.`;

        if (!cleanedUserPrompt.length) {
            return `${REACT_SYSTEM_PROMPT}\n${recallBoundary}`;
        }

        return `${REACT_SYSTEM_PROMPT}\n${recallBoundary}\n\nUser system prompt:\n${cleanedUserPrompt}`;
    }

    private getMaximumReasoningRecalls(): number {
        const configuredValue = this.agentConfig.maximumReasoningRecalls;

        if (configuredValue === undefined) {
            return DEFAULT_MAX_REASONING_RECALLS;
        }

        if (!Number.isFinite(configuredValue) || configuredValue < 0) {
            return DEFAULT_MAX_REASONING_RECALLS;
        }

        return Math.floor(configuredValue);
    }

    // Detect explicit internal recall command returned by the model.
    private parseRecallInstruction(answer: ReActAgentInvokeResult["messages"]): string | null {
        const latestAIMessage = [...answer]
            .reverse()
            .find((message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim());

        if (!latestAIMessage?.content) {
            return null;
        }

        const trimmedContent = latestAIMessage.content.trim();

        if (!trimmedContent.startsWith(RECALL_MAIN_NODE_PREFIX)) {
            return null;
        }

        const instruction = trimmedContent.slice(RECALL_MAIN_NODE_PREFIX.length).trim();
        return instruction.length > 0 ? instruction : null;
    }

    // Remove raw recall command from the transcript so user-visible history stays clean.
    private stripRecallDirectiveFromTail(): void {
        const lastMessage = this.agentConfig.messages.at(-1);

        if (lastMessage?.type !== "ai" || !lastMessage.content?.trim()) {
            return;
        }

        if (!lastMessage.content.trim().startsWith(RECALL_MAIN_NODE_PREFIX)) {
            return;
        }

        this.agentConfig.messages = this.agentConfig.messages.slice(0, -1);
    }

    // Generate the final conclusion with a dedicated LLM summary call over the full transcript.
    private async appendConclusionMessage(): Promise<void> {
        this.emitEvent("concluding_start");
        
        const transcript = this.agentConfig.messages
            .map((message, index) => {
                const label = `${index + 1}. ${message.type}`;

                if (message.type === "tool") {
                    const toolName = message.tool_name ?? message.tool_id;
                    const output = message.toolOutput ?? message.content;
                    return `${label} | ${toolName}: ${output}`;
                }

                if (message.type === "thinking") {
                    return `${label} | ${message.content}`;
                }

                return `${label} | ${message.content}`;
            })
            .join("\n");

        const previousTools = this.agentConfig.model.config.tools;
        const previousMessages = this.agentConfig.model.config.messages;

        try {
            this.agentConfig.model.config.tools = [];
            this.agentConfig.model.config.messages = [
                {
                    type: "system",
                    content: CONCLUSION_SYSTEM_PROMPT
                },
                {
                    type: "user",
                    content: [
                        "Write the final user-facing conclusion from this transcript.",
                        "If there were tool results, use them as evidence.",
                        "If the run ended because of recall limit, summarize the best available answer.",
                        "",
                        transcript
                    ].join("\n")
                }
            ];

            const conclusionResult = await this.agentConfig.model.invoke({
                messages: this.agentConfig.model.config.messages
            });

            this.emitEvent("llm_result", conclusionResult);

            const conclusionMessage = conclusionResult.answer.find(
                (message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim()
            );
            const conclusionMessageContent = conclusionMessage?.content ?? "Conclusion could not be generated from the transcript.";

            this.emitEvent("concluding_end", conclusionMessageContent);
            this.agentConfig.messages = [
                ...this.agentConfig.messages,
                {
                    type: "ai",
                    content: conclusionMessageContent
                }
            ];
        } finally {
            this.agentConfig.model.config.tools = previousTools;
            this.agentConfig.model.config.messages = previousMessages;
            this.synchronizeModelConfig();
        }
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

    private emitStreamEvent(event: ReActAgentStreamChunk): void {
        this.StreamListeners.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.warn("ReAct stream listener failed during execution.", error);
            }
        });
    }

    private mapEventToStreamChunk<EventName extends keyof ReActAgentEvents>(eventName: EventName, ...eventArgs: Parameters<ReActAgentEvents[EventName]>): ReActAgentStreamChunk | null {
        switch (eventName) {
            case "llm_result":
                return {
                    event: "llm_result",
                    content: eventArgs[0] as LLMAnswer
                };
            case "tool_invoked":
                return {
                    event: "tool_invoked",
                    content: {
                        toolName: eventArgs[0] as string,
                        toolParams: eventArgs[1] as Record<string, any>
                    }
                };
            case "tool_executed":
                return {
                    event: "tool_executed",
                    content: {
                        toolName: eventArgs[0] as string,
                        toolParams: eventArgs[1] as Record<string, any>,
                        output: eventArgs[2] as string
                    }
                };
            case "reasoning_end":
                return {
                    event: "reasoning_end",
                    content: {
                        thoughts: eventArgs[0] as string
                    }
                };
            case "result_producing_start":
                return {
                    event: "result_producing_start",
                    content: null
                };
            case "concluding_start":
                return {
                    event: "concluding_start",
                    content: null
                };
            case "concluding_end":
                return {
                    event: "concluding_end",
                    content: {
                        conclusion: eventArgs[0] as string
                    }
                };
            default:
                return null;
        }
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
        const streamEvent = this.mapEventToStreamChunk(eventName, ...eventArgs);

        // Emit stream event
        if (streamEvent) {
            this.emitStreamEvent(streamEvent);
        }

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
        // Start the agent in the background and stream each emitted ReAct event immediately.
        const self = this;

        return {
            async *[Symbol.asyncIterator](): AsyncGenerator<ReActAgentStreamChunk> {
                const eventQueue: ReActAgentStreamChunk[] = [];
                const waiters: Array<() => void> = [];
                let finished = false;
                let failure: unknown = null;

                const wakeNext = () => {
                    const waiter = waiters.shift();
                    if (waiter) {
                        waiter();
                    }
                };

                const pushEvent: ReActAgentStreamListener = (event) => {
                    eventQueue.push(event);
                    wakeNext();
                };

                self.StreamListeners.add(pushEvent);

                const execution = self.invoke()
                    .catch((error) => {
                        failure = error;
                    })
                    .finally(() => {
                        finished = true;
                        wakeNext();
                    });

                try {
                    while (!finished || eventQueue.length > 0) {
                        if (!eventQueue.length) {
                            await new Promise<void>((resolve) => {
                                waiters.push(resolve);
                            });
                            continue;
                        }

                        yield eventQueue.shift() as ReActAgentStreamChunk;
                    }

                    await execution;

                    if (failure) {
                        throw failure;
                    }
                } finally {
                    self.StreamListeners.delete(pushEvent);
                }
            }
        };
    }

    public get messages() {
        return this.agentConfig.messages;
    }
}
