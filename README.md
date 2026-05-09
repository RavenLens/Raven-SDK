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
    import { OpenAI, Anthropic } from "raven-adk/models";
    import * as z from "zod";
    import { MongoDBSkillStore, SkillDiskStore } from "raven-adk/skills/store";
    import { MemoryChromaDBStore } from "raven-adk/memory/store";
    import { HITLSocketIo } from "raven-adk/tools/hitl";

    const reactAgent = new ReActAgent({
        model: new OpenAI({
            model: "gpt-5.5",
            reasoningEffort: "xhigh",
            apiKey: "your-api-key",
        }),
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
            ),
            // Dummy transfer_money tool — used in README example to match HITL toolsUsage
            tool(
                ({ amount, currency, recipient }) => {
                    // This is a dummy implementation for documentation purposes only.
                    // It does NOT perform any real transfer.
                    return JSON.stringify({
                        status: "mocked",
                        transactionId: "tx_mock_0001",
                        amount,
                        currency,
                        recipient
                    })
                },
                {
                    toolName: "transfer_money",
                    toolDescription: "Dummy transfer money tool (mock). Do NOT use in production.",
                    toolArguments: z.object({
                        amount: z.number().describe("Amount to transfer"),
                        currency: z.string().describe("Currency code, e.g. USD"),
                        recipient: z.string().describe("Recipient account identifier or handle")
                    }),
                    toolOutputSchema: z.object({
                        status: z.string().describe("Result status (mocked)"),
                        transactionId: z.string().optional().describe("Simulated transaction id if available")
                    })
                }
            ),
            
        ],
        // Optional skills for agent — MongoDB-backed example
        // The MongoDBSkillStore expects a `collection` object that implements the
        // minimal Collection-like API used by the store (methods like `find`,
        // `findOne`, `insertOne`, `updateOne` and optional `deleteMany`/`deleteOne`).
        // Use the official `mongodb` driver and pass the `Collection` instance.
        // Example (inside an async context):
        //
        // import { MongoClient } from 'mongodb';
        // const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017');
        // await client.connect();
        // const db = client.db('raven-adk');
        // const skillsCollection = db.collection('skills');
        //
        // Then pass `skillsCollection` into the store configuration:
        skills: new MongoDBSkillStore({
            collection: skillsCollection, // a MongoDB Collection instance
            root: 'skills', // optional prefix used inside the store documents
            dynamicSkillCreation: true,
            dynamicSkillRemoval: true,
            dynamicSkillRelocation: true,
            session: 'your-session-id' // scope skills per user/session if desired
        }),
        // Optional agent memory -> use to remember and read the information
        memory: new MemoryChromaDBStore({
            // Optional: Don't specify if you'd like to use the default connection is on address `127.0.0.1:8000`
            chromaDBConfig: {
                host: "your-chromadb-address",
                port: 8000
            },
            hasToRemember: [
                "* User name",
                "* User subjects of interest: e.g: Ferrari Cars, Apple devices"
            ].join('\n'),
            session: 'your-session-id',
        }),
        // Optional Human-In-The-Loop. Agent asks only when really required.
        hitl: new HITLSocketIo({
            port: 3000,
            questions: {
                abcQuestion: {
                    instruction: "Use only for decisions where one option must be chosen.",
                    maxAnswersRange: ["a", "b", "c", "d"]
                },
                openQuestion: {
                    instruction: "Use only when the required detail cannot be represented as predefined options."
                }
            },
            toolsUsage: {
                transfer_money: {
                    delayMs: 30000,
                    defaultAnswer: "deny"
                },
                delete_account: true
            }
        }),
        // Optional: Specify your subagents
        subagents: [
            {
                role: "actor",
                roleDescritpion: "You're the professional Hollywood actor",
                systemPrompt: `...Agent System Prompt`,
                model: new Anthropic({
                    model: "claude-sonnet-4-6"
                    apiKey: "your-api-key",
                    thinking: {
                        type: "enabled",
                        budget_tokens: 10_000,
                        display: "summarized"
                    },
                    max_tokens: 16_000
                }),
                // Optional list with tools,
                tools: []
            },
            // ... Define more subagents below
        ]
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
[Read more about RavenADK skills](./Skills.md)

## Contribution
If you would like to become official contributor contact with one of bellow channels

* [Discord](https://discord.gg/eFfVjDj7Xd)
* [email](mailto:official@ravenlens.io)
* [LinkedIn](https://www.linkedin.com/in/micha%C5%82-szczepa%C5%84ski-0476192a8/)

### Your ideas are going to be appreciated
You can openly tell your your idea in the **issues** or in the one of above specified channels
