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
     * In CASCADE (https://arxiv.org/abs/2512.23880) secenario -> agent can develop his own skills
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
    tool_executed: (toolName: string, toolParamse: Record<string, any>, output: string) => void | Promise<void>;
    /** Is produced at the end of reasoning phase */
    reasoning_end: (thoughts: string) => void | Promise<void>;
    /** When agent start to produce output */
    result_producing_start: () => void | Promise<void>;
}

/** 
 * This node is suppose to: 
 * 1. Reason
 * 2. Make actions
 * 3. Execute tools -> by calling the -> add tool execution as last state message and call the `tools_node` 
 * 4. Reason above tool execution
 * 5. Produce output by calling the GraphMarkers.END -> TODO: graph node can call END to finish execution
 * 6. Register events to be called
*/
export class ReActAgent<Skills extends SkillsFoundation, Knowledge extends KnowledgeFoundation> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    agentConfig: ReActAgentConfig<Skills, Knowledge>;

    constructor(config: ReActAgentConfig<Skills, Knowledge>) {
        this.agentConfig = config;

        // TODO: Add wrapper for system prompt to include behaviour for the agent
        
        // Define graph
        const reactAgentGraph = new Graph<AgentMessagesGraphState>({})
        reactAgentGraph
            .addNode("main_node", async state => {
                if (state.callTools) { // Retrive executed tools
                    // Asssign the tools output to the messages of agent
                    this.agentConfig.messages = [
                        ...this.agentConfig.messages,
                        ...state.callTools.recentModelAnswers.map(answerMsg => {
                            if (answerMsg.type === "tool") {
                                const toolExecutedFound = state.callTools!.tools.find(toolCall => toolCall.tool_id === answerMsg.tool_id);
                                if (!toolExecutedFound) {
                                    return {
                                        ...answerMsg,
                                        toolError: "Tool doesn't exist on tools execution list"
                                    }
                                }

                                return toolExecutedFound;
                            }
                            else return answerMsg
                        })
                    ]
                    
                    // Reset tools call after all processing
                    delete state.callTools

                    // Update state
                    return {
                        callNode: "main_node",
                        stateUpdate: {
                            ...state,
                            // Attach to signalize in main flow that tools retrived the result
                            toolsOutputRetrived: true 
                        }
                    }
                }
                else { // main_flow of the agent
                    if (state.toolsOutputRetrived) {
                        this.agentConfig.messages = [
                            ...this.agentConfig.messages,
                            {
                                type: "ai",
                                content: "Tools were executed. View the result and continue reasoning for user specified task"
                            }
                        ];

                        delete state.toolsOutputRetrived;
                    }
                    
                    // TODO: Add some message will help agent to recall himself otherwise it will be guided to the end where the last message has to be ai assistant message always
                    const modelInvoke = await this.agentConfig.model.invoke({ messages: this.agentConfig.messages });
                    
                    // Call tools when tools were specified
                    const toolAnswers = modelInvoke.answer.filter(answerMsg => answerMsg.type === "tool");
                    if (toolAnswers.length) { // Call all tools from agent
                        return {
                            callNode: "tools_node",
                            stateUpdate: {
                                callTools: {
                                    tools: toolAnswers,
                                    recentModelAnswers: modelInvoke.answer
                                }
                            }
                        }
                    }

                    // Update recent messages are the agent answers
                    this.agentConfig.messages = modelInvoke.messages;

                    // Update state
                    return {
                        stateUpdate: state
                    }
                }
            })
            .addNode("tools_node", async state => {
                /**
                 * This node is going to execute tools -> add result of tool call to the last message and call back the `main_node`
                */
                if (state.callTools?.tools.length) {
                    // Execute tools in parallel
                    const { tools: definedTools } = this.agentConfig;
                    const { tools: callTools } = state.callTools;

                    // Prepare tools to call
                    const foundDefinedTools = definedTools.map(defTool => {
                        const callToolFound = callTools.find(toolCall => toolCall.tool_id === defTool.toolConfig.toolName);

                        // FIXME: Someday verify the arguments of the tool to with what was tool execute
                        const desiredArgumentsSchema = defTool.toolConfig.toolArguments;

                        if (callToolFound) {
                            return {
                                ...defTool,
                                invokeWithArguments: callToolFound?.arguments
                            };
                        }

                        return;
                    }).filter(tool => tool !== undefined);

                    // Find tools were desired to call but doesn't exists on tools list
                    const toolsDoesNotExist = callTools.filter(toolCall => !definedTools.some(defTool => defTool.toolConfig.toolName !== toolCall.tool_id));

                    // Execute tools in concurrency
                    const executedTools = await Promise.all(
                        foundDefinedTools.map(fDefTool => {
                            return new Promise<typeof fDefTool & { output: string }>(async res => {
                                const executedOutput = await fDefTool.toolLogic(fDefTool.invokeWithArguments)
                                
                                // FIXME: Validate schema someday
                                const desiredOutputSchema = fDefTool.toolConfig.toolOutputSchema

                                res({
                                    ...fDefTool,
                                    output: executedOutput
                                });
                            });
                        })
                    );

                    // Assign to state output `tools` the executed results
                    const toolsStatePrepared = state.callTools.tools.map(tool => {
                        const isToolOnListOfToolsDoesNotExist = () => toolsDoesNotExist.some(toolDNE => toolDNE.tool_id === tool.tool_id)
                        
                        return {
                            ...tool,
                            toolOutput: executedTools.find(exToolOutput => exToolOutput.toolConfig.toolName === tool.tool_id)?.output ?? (isToolOnListOfToolsDoesNotExist() ? `Tool couldn't be executed. This is because of tool with this name "${tool.tool_id}" doesn't exist` : "Tool from some of reason couldn't be executed. Try to make action again or use different tool")
                        };
                    });

                    // Return execution back to the `main_node`
                    return {
                        callNode: "main_node",
                        stateUpdate: {
                            ...state,
                            callTools: {
                                ...state.callTools,
                                tools: toolsStatePrepared
                            }
                        }
                    }
                }
                else return {
                    callNode: "main_node",
                    stateUpdate: {
                        ...state
                    }
                }
            })
            .addEdge(GraphMarkers.START, "main_node")
            .addEdge("main_node", GraphMarkers.END);
            // End don't have to be defined similary as the tools_node since these will be called dynamically

        this.AgentGraph = reactAgentGraph;
    }

    onEvent<EventName extends keyof ReActAgentEvents>(eventName: EventName, eventListener: ReActAgentEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof ReActAgentEvents>(eventName: EventName, ...eventArgs: Parameters<ReActAgentEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as ReActAgentEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    /** TODO: 
     * Use to invoke the specified agent
    */
    async invoke() {

    }

    /** TODO: 
     * In this mode agent stream will be produced for the
     * Final Output -> where each token is streamlined 
     * Reasoning tokens - when model is reasoning its tokens are streamed one by one
    */
    async invokeStream() {

    }
  
    public get messages() {
        return this.agentConfig.messages;
    }
    
}
