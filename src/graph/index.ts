export enum GraphMarkers {
    START = "__START__",
    END = "__END__"
}

interface GraphNodeExecutionResult<GraphState extends Record<string, any>> {
    stateUpdate?: GraphState;
    callNode?: string;
}

type NodeLogic<GraphState extends Record<string, any>> = (fromNodeId: string, graphState: GraphState) => GraphNodeExecutionResult<GraphState> | Promise<GraphNodeExecutionResult<GraphState>> | undefined;

interface GraphEvents<GraphState extends Record<string, any>> {
    node_start: (nodeId: string, state: GraphState) => void | Promise<void>;
    node_end: (nodeId: string, state: GraphState) => void | Promise<void>;
    state_change: (nodeId: string, stateBefore: GraphState, stateAfter: GraphState) => void | Promise<void>;
}

export class Graph<GraphState extends Record<string, any>> {
    private NodesLogic: Record<string, NodeLogic<GraphState>> = {};
    private NodesEdgeConnections: [string, string][] = [];
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    graphState: GraphState;
    
    constructor(graphState: GraphState) {
        this.graphState = graphState;
    }
    
    addNode(nodeId: string, logic: NodeLogic<GraphState>) {
        this.NodesLogic[nodeId] = logic;
    }

    addEdge(fromNodeId: string, toNodeId: string) {
        this.NodesEdgeConnections = [
            ...this.NodesEdgeConnections,
            [fromNodeId, toNodeId]
        ];
    }

    onEvent<EventName extends keyof GraphEvents<GraphState>>(eventName: EventName, eventListener: GraphEvents<GraphState>[EventName]) {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return;
        }

        this.EventsListeners[eventName] = eventListener;
    }

    protected emitEvent<EventName extends keyof GraphEvents<GraphState>>(eventName: EventName, ...eventArgs: Parameters<GraphEvents<GraphState>[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as GraphEvents<GraphState>[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    async start(): Promise<void> {
        const firstNode = this.NodesEdgeConnections.at(0)?.[0];
        const lastNode = this.NodesEdgeConnections.at(-1)?.[1];

        // Check of graph assembly correcteness
        if (firstNode !== GraphMarkers.START) {
            throw(`First Node has to be equal to "${GraphMarkers.START}" to invoke graph execution`);
        }

        if (lastNode !== GraphMarkers.END) {
            throw(`Last Node has to be equal to "${GraphMarkers.END}" to finish graph execution`);
        }

        // Execute Graph
        let executionIndexPosition = 0;
        for (const [fromNodeScheduledId, toNodeScheduledId] of this.NodesEdgeConnections) {
            const fromNodeScheduledLogic = this.NodesLogic[fromNodeScheduledId];
            const toNodeScheduledLogic = this.NodesLogic[toNodeScheduledId];

            // Check correcteness of the execution
            /// Verify is the start and end nodes used properly
            const forbiddenPositionMarkersMeanwhileExecution = [GraphMarkers.START, GraphMarkers.END];
            const lastExecutionPositonIndex = this.NodesEdgeConnections.length - 1;
            
            const forbiddenNodeInBetweenExecutionLogic = (executionIndexPosition !== 0 && lastExecutionPositonIndex) && (forbiddenPositionMarkersMeanwhileExecution.includes(fromNodeScheduledId as any) || forbiddenPositionMarkersMeanwhileExecution.includes(toNodeScheduledId as any));
            const forbiddenNodeKeyPositions = (executionIndexPosition === 0 && forbiddenPositionMarkersMeanwhileExecution.includes(toNodeScheduledId as any)) || (executionIndexPosition === lastExecutionPositonIndex && forbiddenPositionMarkersMeanwhileExecution.includes(fromNodeScheduledId as any))

            if (forbiddenNodeInBetweenExecutionLogic || forbiddenNodeKeyPositions) {
                throw(`"${GraphMarkers.START}" and "${GraphMarkers.END}" cannot be position as between execution nodes. These nodes can be respectivelly put as start or end nodes only`)
            }
            
            /// Verify is the start and end node the one suppose to be
            if ((!fromNodeScheduledLogic && fromNodeScheduledId !== GraphMarkers.START) || (!toNodeScheduledLogic && toNodeScheduledId !== GraphMarkers.END)) {
                throw("Node logic has to be planned");
            }

            // Execute Nodes
            const processNodesExecutionResult = async (logicExecutionResult: Awaited<ReturnType<NodeLogic<GraphState>>>, registerForNodeType: "from" | "to", registerForNodeId: string) => {
                // Update node state
                if (logicExecutionResult?.stateUpdate) {
                        // Emit state change
                        this.emitEvent("state_change", registerForNodeId, this.graphState, logicExecutionResult.stateUpdate);

                    // Change state
                    this.graphState = logicExecutionResult.stateUpdate;
                }

                // Execute other node when was planned to be executable
                if (logicExecutionResult?.callNode) {
                    let executeWrapped = true;
                    
                    while(executeWrapped) {
                        // TODO:
                        break;
                    }
                }
            }
            
            /// From Execution
            if (fromNodeScheduledId !== GraphMarkers.START) { // Start node hasn't logic so it's ignored
                this.emitEvent("node_start", fromNodeScheduledId, this.graphState);
                
                const resultFrom = await fromNodeScheduledLogic(fromNodeScheduledId, this.graphState);
                await processNodesExecutionResult(resultFrom, "from", fromNodeScheduledId);

                this.emitEvent("node_end", fromNodeScheduledId, this.graphState)
            }

            /// To Execution
            if (toNodeScheduledId !== GraphMarkers.END) { // End node hasn't logic so it's ignored
                this.emitEvent("node_start", toNodeScheduledId, this.graphState);
                
                const resultTo = await toNodeScheduledLogic(toNodeScheduledId, this.graphState);
                await processNodesExecutionResult(resultTo, "to", toNodeScheduledId);

                this.emitEvent("node_end", toNodeScheduledId, this.graphState);
            }

            //  Increment exctuon index executionIndexPosition
            executionIndexPosition += 1;
        }
    }
    
    getState(): GraphState {
        return this.graphState;
    }
}
