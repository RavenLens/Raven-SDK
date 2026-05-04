export enum GraphMarkers {
    START = "__START__",
    END = "__END__"
}

interface GraphNodeExecutionResult<GraphState extends Record<string, any>> {
    stateUpdate?: GraphState;
    callNode?: NodeEdgeIdDistribution;
}

type NodeLogic<GraphState extends Record<string, any>> = (graphState: GraphState, nodeId: string) => GraphNodeExecutionResult<GraphState> | Promise<GraphNodeExecutionResult<GraphState> | undefined> | undefined;

interface GraphEvents<GraphState extends Record<string, any>> {
    node_start: (nodeId: string, state: GraphState) => void | Promise<void>;
    node_end: (nodeId: string, state: GraphState) => void | Promise<void>;
    state_change: (nodeId: string, stateBefore: GraphState, stateAfter: GraphState) => void | Promise<void>;
}

type NodeEdgeIdDistribution = string | string[];
interface EdgeOptions {
    asynchronous?: boolean;
}

interface NodeEdgeConnection {
    from: string[];
    to: string[];
    options: EdgeOptions;
}

export class Graph<GraphState extends Record<string, any>> {
    private NodesLogic: Record<string, NodeLogic<GraphState>> = {};
    private NodesEdgeConnections: NodeEdgeConnection[] = [];
    private EdgeSyncWatermarks: Record<string, number>[] = [];
    private NodeCompletionCounts: Record<string, number> = {};
    private HasReachedEnd = false;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    graphState: GraphState;
    
    constructor(graphState: GraphState) {
        this.graphState = graphState;
    }

    private normalizeDistribution(nodeDistribution: NodeEdgeIdDistribution): string[] {
        const normalized = Array.isArray(nodeDistribution) ? nodeDistribution : [nodeDistribution];

        if (normalized.length === 0) {
            throw("Node edge distribution cannot be empty");
        }

        return normalized;
    }

    private getNodeCompletionCount(nodeId: string): number {
        return this.NodeCompletionCounts[nodeId] ?? 0;
    }

    private incrementNodeCompletion(nodeId: string): void {
        this.NodeCompletionCounts[nodeId] = this.getNodeCompletionCount(nodeId) + 1;
    }

    private updateEdgeWatermark(edgeIndex: number): void {
        const edge = this.NodesEdgeConnections[edgeIndex];
        const edgeWatermark = this.EdgeSyncWatermarks[edgeIndex];

        for (const fromNodeId of edge.from) {
            edgeWatermark[fromNodeId] = this.getNodeCompletionCount(fromNodeId);
        }
    }

    private shouldTriggerEdge(edgeIndex: number): boolean {
        const edge = this.NodesEdgeConnections[edgeIndex];

        if (edge.options.asynchronous) {
            return true;
        }

        const edgeWatermark = this.EdgeSyncWatermarks[edgeIndex];

        for (const fromNodeId of edge.from) {
            const completionCount = this.getNodeCompletionCount(fromNodeId);
            const watermark = edgeWatermark[fromNodeId] ?? 0;

            if (completionCount <= watermark) {
                return false;
            }
        }

        return true;
    }

    private enqueueEdgeTargets(queue: string[], targets: string[]): void {
        for (const nodeId of targets) {
            if (nodeId === GraphMarkers.END) {
                this.HasReachedEnd = true;
                continue;
            }

            queue.push(nodeId);
        }
    }

    private processOutgoingEdges(completedNodeId: string, queue: string[]): void {
        for (let edgeIndex = 0; edgeIndex < this.NodesEdgeConnections.length; edgeIndex += 1) {
            const edge = this.NodesEdgeConnections[edgeIndex];

            if (!edge.from.includes(completedNodeId)) {
                continue;
            }

            if (!this.shouldTriggerEdge(edgeIndex)) {
                continue;
            }

            this.updateEdgeWatermark(edgeIndex);
            this.enqueueEdgeTargets(queue, edge.to);
        }
    }

    private validateAssembly(): void {
        const firstEdge = this.NodesEdgeConnections.at(0);
        const lastEdge = this.NodesEdgeConnections.at(-1);

        if (!firstEdge || !lastEdge) {
            throw("Graph has to include at least one edge");
        }

        if (firstEdge.from.length !== 1 || firstEdge.from[0] !== GraphMarkers.START) {
            throw(`First edge has to start with "${GraphMarkers.START}" only`);
        }

        if (lastEdge.to.length !== 1 || lastEdge.to[0] !== GraphMarkers.END) {
            throw(`Last edge has to end with "${GraphMarkers.END}" only`);
        }

        const lastEdgeIndex = this.NodesEdgeConnections.length - 1;

        for (let edgeIndex = 0; edgeIndex < this.NodesEdgeConnections.length; edgeIndex += 1) {
            const edge = this.NodesEdgeConnections[edgeIndex];

            if (edge.from.includes(GraphMarkers.END) || edge.to.includes(GraphMarkers.START)) {
                throw(`"${GraphMarkers.START}" and "${GraphMarkers.END}" cannot be used as regular execution nodes`);
            }

            if (edgeIndex !== 0 && edge.from.includes(GraphMarkers.START)) {
                throw(`"${GraphMarkers.START}" can be used only in the first edge source`);
            }

            if (edgeIndex !== lastEdgeIndex && edge.to.includes(GraphMarkers.END)) {
                throw(`"${GraphMarkers.END}" can be used only in the last edge target`);
            }

            for (const fromNodeId of edge.from) {
                if (fromNodeId !== GraphMarkers.START && !this.NodesLogic[fromNodeId]) {
                    throw(`Node logic has to be planned for "${fromNodeId}"`);
                }
            }

            for (const toNodeId of edge.to) {
                if (toNodeId !== GraphMarkers.END && !this.NodesLogic[toNodeId]) {
                    throw(`Node logic has to be planned for "${toNodeId}"`);
                }
            }
        }
    }

    private async processNodeResult(nodeId: string, logicExecutionResult: Awaited<ReturnType<NodeLogic<GraphState>>>, queue: string[]): Promise<void> {
        if (!logicExecutionResult) {
            return;
        }

        if (logicExecutionResult.stateUpdate) {
            this.emitEvent("state_change", nodeId, this.graphState, logicExecutionResult.stateUpdate);
            this.graphState = logicExecutionResult.stateUpdate;
        }

        if (!logicExecutionResult.callNode) {
            return;
        }

        const redirectNodes = this.normalizeDistribution(logicExecutionResult.callNode);

        for (const redirectNodeId of redirectNodes) {
            await this.executeNode(redirectNodeId, queue, false);
        }
    }

    private async executeNode(nodeId: string, queue: string[], shouldDistributeByEdges: boolean): Promise<void> {
        const nodeLogic = this.NodesLogic[nodeId];

        if (!nodeLogic) {
            throw(`Node logic has to be planned for "${nodeId}"`);
        }

        this.emitEvent("node_start", nodeId, this.graphState);

        const logicExecutionResult = await nodeLogic(this.graphState, nodeId);
        await this.processNodeResult(nodeId, logicExecutionResult, queue);

        this.emitEvent("node_end", nodeId, this.graphState);

        if (!shouldDistributeByEdges || this.HasReachedEnd) {
            return;
        }

        this.incrementNodeCompletion(nodeId);
        this.processOutgoingEdges(nodeId, queue);
    }
    
    addNode(nodeId: string, logic: NodeLogic<GraphState>): this {
        this.NodesLogic[nodeId] = logic;
        return this;
    }

    addEdge(fromNodeId: NodeEdgeIdDistribution, toNodeId: NodeEdgeIdDistribution, edgeOptions?: EdgeOptions): this {
        const normalizedFromNodeId = this.normalizeDistribution(fromNodeId);
        const normalizedToNodeId = this.normalizeDistribution(toNodeId);

        this.NodesEdgeConnections = [
            ...this.NodesEdgeConnections,
            {
                from: normalizedFromNodeId,
                to: normalizedToNodeId,
                options: {
                    asynchronous: edgeOptions?.asynchronous ?? false
                }
            }
        ];

        this.EdgeSyncWatermarks.push({});
        return this;
    }

    onEvent<EventName extends keyof GraphEvents<GraphState>>(eventName: EventName, eventListener: GraphEvents<GraphState>[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
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
        this.validateAssembly();
        this.HasReachedEnd = false;
        this.NodeCompletionCounts = {
            [GraphMarkers.START]: 1
        };
        this.EdgeSyncWatermarks = this.NodesEdgeConnections.map((edge) => {
            const watermark: Record<string, number> = {};

            for (const fromNodeId of edge.from) {
                watermark[fromNodeId] = 0;
            }

            return watermark;
        });

        const executionQueue: string[] = [];
        this.processOutgoingEdges(GraphMarkers.START, executionQueue);

        while (executionQueue.length > 0 && !this.HasReachedEnd) {
            const nextNodeId = executionQueue.shift();

            if (!nextNodeId) {
                continue;
            }

            await this.executeNode(nextNodeId, executionQueue, true);
        }
    }
    
    getState(): GraphState {
        return this.graphState;
    }
}
