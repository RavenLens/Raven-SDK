import { Graph, GraphMarkers } from "../graph";
import { AnthropicAIApiLLM, CustomLLM, OpenAIApiLLM } from "../models";
import { KnowledgeFoundation } from "./knowledge";
import { SkillsFoundation } from "./skills";
import { AgentMessagesGraphState, MessagesVariations } from "./state";
import { Tool } from "./tools";

interface ReActAgentConfig<Skills extends SkillsFoundation, Knowledge extends KnowledgeFoundation> {
    model: OpenAIApiLLM | AnthropicAIApiLLM | CustomLLM;
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

export class ReActAgent<Skills extends SkillsFoundation, Knowledge extends KnowledgeFoundation> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    agentConfig: ReActAgentConfig<Skills, Knowledge>;

    constructor(config: ReActAgentConfig<Skills, Knowledge>) {
        this.agentConfig = config;

        // Define graph
        const reactAgentGraph = new Graph<AgentMessagesGraphState>({
            messages: config.messages
        })
        reactAgentGraph
            .addNode("main_node", () => {
                /** 
                 * TODO: 
                 * This node is suppose to: 
                 * 1. Reason
                 * 2. Make actions
                 * 3. Execute tools -> by calling the -> add tool execution as last state message and call the `tools_node` 
                 * 4. Reason above tool execution
                 * 5. Produce output by calling the GraphMarkers.END -> TODO: graph node can call END to finish execution
                 * 6. Register events to be called
                */
            })
            .addNode("tools_node", () => {
                /**
                 * TODO: 
                 * 1. This node is going to execute tools -> add result of tool call to the last message and call back the `main_node`
                 */
            })
            .addEdge(GraphMarkers.START, "main_node");
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
