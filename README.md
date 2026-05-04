# Raven ADK
Open source Agent Developement Kit ***made to support wild AI-Agents Developement initiatives***. Gives native support for JavaScript environments, ***strongly base on events population*** - each action of library can be captured as the event what simplifies creating of breathtaking UX like: user see that agent is now thinking without complicated logic on side of developement. Open from definition; Anyone can become contributor

## GraphBased
Use graph with this style to make your own workflow

```typescript
import { Graph, GraphMarkers } from "raven-adk";

const graphState = { invokeTimes: 0 };
const graph = new Graph(graphState);

// Listen events execution
graph.onEvent("node_start", (nodeId, state) => {
    // When node execution has begun
});

graph.onEvent("node_end", (nodeId, state) => {
    // When node was finished (after return)
});

graph.onEvent("state_change", (nodeId, stateBefore, stateAfter) => {
    // When state was changed before node execution
});

// Graph Src logic
graph
    .addNode("node_1", (graphState) => {
        /// your logic
        if (invokeTimes === 1) {
            return {}; // Empty object when no state nor node was updated -> then will be called node introduced by the edge
        }

        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            },
            // Overrides node calling logic -> can call different node with this
            callNode: "node_1"
        }
    })
    .addNode("node_2", async (graphState) => {
        /// your logic
        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            }
        }
    })
    .addEdge(GraphMarkers.START, "node_1")
    .addEdge("node_1", "node_2")
    .addEdge("node_2", GraphMarkers.END);

// Start graph execution
await graph.start();

// Returns your updated state via all nodes execution
const updatedState = graph.getState(); // OR: graph.graphState;
```

### Graph Modes
#### Synchronous One-to-One

```typescript
const graphState = { invokeTimes: 0 };
const graph = new Graph(graphState);

graph
    .addNode("node_1", (graphState) => {
        /// your logic
        if (invokeTimes === 1) {
            return {}; // Empty object when no state nor node was updated -> then will be called node introduced by the edge
        }

        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            },
            // Overrides node calling logic -> can call different node with this
            callNode: "node_1"
        }
    })
    .addNode("node_2", async (graphState) => {
        /// your logic
        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            }
        }
    })
    .addEdge(GraphMarkers.START, "node_1")
    .addEdge("node_1", "node_2")
    .addEdge("node_2", GraphMarkers.END);

// Start graph execution
await graph.start();
```

#### Synchronous One-to-Multiple / Multiple-to-One / Multiple-to-Multiple

```typescript
const graphState = { invokeTimes: 0 };
const graph = new Graph(graphState);

graph
    .addNode("node_1", (graphState) => {
        /// your logic
        if (graphState.invokeTimes === 1) {
            return {}; // Empty object when no state nor node was updated -> then will be called node introduced by the edge
        }

        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            },
            // Overrides node calling logic -> can call different node with this
            callNode: "node_1"
        }
    })
    .addNode("node_2", async (graphState) => {
        if (graphState.invokeTimes === 1) {
            return {
                stateUpdate: {
                    ...graphState,
                    invokeTimes: graphState.invokeTimes + 1
                },
                callNode: ["node_2", "node_3"] // call nodes and when nodes returns output without calling other nodes, it's passed back to here body 
            }
        }
        
        /// your logic
        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            }
        }
    })
    .addNode("node_3", graphState => {
        // your logic

    })
    .addNode("node_4", graphState => {
        // your logic
    })
    .addEdge(GraphMarkers.START, "node_1")
    .addEdge("node_1", ["node_2", "node_3"]) // One-to-Multiple
    .addEdge(["node_2", "node_3"], ["node_2", "node_3"]) // Multiple-to-Multiple
    .addEdge(["node_2", "node_3"], "node_4") // Multiple-to-One
    .addEdge("node_4", GraphMarkers.END);

// Start graph execution
await graph.start();
```

#### Asynchronous
- turn asynchronous mode by adding option to edge with property `{ asynchronous: true }`

```typescript
const graphState = { invokeTimes: 0 };
const graph = new Graph(graphState);

graph
    .addNode("node_1", (graphState) => {
        /// your logic
        if (graphState.invokeTimes === 1) {
            return {}; // Empty object when no state nor node was updated -> then will be called node introduced by the edge
        }

        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            },
            // Overrides node calling logic -> can call different node with this
            callNode: "node_1"
        }
    })
    .addNode("node_2", async (graphState) => {
        if (graphState.invokeTimes === 1) {
            return {
                stateUpdate: {
                    ...graphState,
                    invokeTimes: graphState.invokeTimes + 1
                },
                callNode: ["node_2", "node_3"] // call nodes and when nodes returns output without calling other nodes, it's passed back to here body 
            }
        }
        
        /// your logic
        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            }
        }
    })
    .addNode("node_3", graphState => {
        // your logic

    })
    .addNode("node_4", graphState => {
        // your logic
    })
    .addEdge(GraphMarkers.START, "node_1")
    .addEdge("node_1", ["node_2", "node_3"], { asynchronous: true }) // One-to-Multiple
    .addEdge(["node_2", "node_3"], "node_4", , { asynchronous: true }) // Multiple-to-One
    .addEdge("node_4", GraphMarkers.END);

// Start graph execution
await graph.start();
```

##### Details
* A node can redirect execution to one node or many nodes through `callNode`.
* A node can also redirect to itself, so recursive/self-reentry flows are supported.
* In synchronous mode, an edge fires only after every source node on that edge has completed since the last trigger.
* Multi-source edges support the same sync rule, so one-to-many, many-to-one, and many-to-many flows are all resolved through source-completion gating.
* In asynchronous mode, set `{ asynchronous: true }` on the edge to fire it after each source node finishes.
* Redirected `callNode` executions from ***Node Logic*** do not fan out their own edges; control returns to the original caller, and its normal edge distribution continues after the redirected execution finishes.


## Contribution
If you would like to become official contributor contact with one of bellow channels

* [Discord](https://discord.gg/eFfVjDj7Xd)
* [email](mailto:official@ravenlens.io)
* [LinkedIn](https://www.linkedin.com/in/micha%C5%82-szczepa%C5%84ski-0476192a8/)
