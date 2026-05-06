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

> [Check more about graph](./Graph.md)

## Agent
### ReAct Agent
ReAct Agent is the standalone agent of RavenADK -> it's about to Reason atop of given task and act in his behalf to accomplish given task The best as possible

> **ReAct** agent will: Reason, Make Actions, Use tools, Produce Thoughts and at the end produce output

This is how to create ReAct agent
```typescript
    import { ReActAgent } from "raven-adk/agents";
    import { tool } from "raven-adk/tools";

    const reactAgent = new ReActAgent({
        systemPrompt: `Your system prompt`,
        messages: [
            {
                type: "user",
                content: "Check the weather condition"
            }
        ],
        tools: [
            tool(
                ({ location }) => {
                    // Tool output has to be a string
                    return JSON.stringify({
                        humidity: 27,
                        temperatureCelsius: 20,
                        temperatureFahrenheit: 68
                    })
                }, 
                {
                    toolName: "get_weather",
                    toolDescription: "Check weather condtion for given location",
                    toolArguments: z.object({
                        location: z.string().describe("This is the location from where we want to get weather")
                    }),
                    // optional -> to give model better understaning what is in the stringified tool output
                    toolOutputSchema: z.object({
                        humidity: z.number().describe("Percentage level of oxygen humidity"),
                        temperatureCelsius: z.number().describe("Termperature in Celsius Scale"),
                        temperatureFahrenheit: z.number().describe("Temperature in Fahrenheit Scale")
                    })
                }
            )
        ],
        skills: // optional skills for agent; TODO: Setup agent skills; 
        knowledge: , // optional agent knowledge TODO: Setup agent knowledge
    });

    // Listend agent events
    reactAgent.onEvent("tool_invoked", (toolName, toolParams) => {

    });

    /// ... Register more events from available set as needed

    // Invoke agent (after when agent events were registered)
    const agentSync = await reactAgent.invoke();

    // Get agent output
    const agentResponse = agentSync.messages.at(-1).content;
```

#### Skills
Skills of RavenADK are compliant with open [skills standard](https://agentskills.io/home) what is use by e.g: Claude Code, MS Copilot and likelly more

## Contribution
If you would like to become official contributor contact with one of bellow channels

* [Discord](https://discord.gg/eFfVjDj7Xd)
* [email](mailto:official@ravenlens.io)
* [LinkedIn](https://www.linkedin.com/in/micha%C5%82-szczepa%C5%84ski-0476192a8/)

### Your ideas are going to be appreciated
You can openly tell your your idea in the **issues** or in the one of above specified channels
