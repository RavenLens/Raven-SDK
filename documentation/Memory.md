# Memory
Memory in RavenADK agents provide you way to remember data from interactions with user and get them recalled in next iterations what makes vivid user interactions. Such informations can be manipulated via Memory: 
    - user name
    - user preferrences
    - user given task
    - user conversation style schema - it can be 
Finally you've full agency to decide what agent has to remember, what should so you decide the agent behaviour

## Configuring memory for ReAct Agent
```typescript
    import { ReActAgent } from "raven-adk/agents";
    import { tool } from "raven-adk/tools";
    import { MongoDBSkillStore, SkillDiskStore } from "raven-adk/skills/store";
    import { MemoryChromaDBStore } from "raven-adk/memory/store";

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
    });

    // ... Rest of agent logic
```

## Controlling what agent can remember
Pass tp agent config object `memory.hasToRememeber` output with output value will be string. This has to be list with specification for agent according with what has it to rememeber

## Memory model
This subsection describe how the agent memory work.

> RavenADK memory is graph of knowledge with mutual relations assigned as edges where nodes are the wards of knowledge e.g: user prefferences like birthday, user friends, user used programs and so on. Each information is connected to another communication with weight. RavenADK memory system base too on the weight system where the more relevant informations gets higher weight and less vibrant lower weight

#### Memory details
- Memory is fetched with these techniques:
    - semantically (base on semantic search) or according to relevance
    - by exploration like the tower - agent can explore the knowledge by going through it like you go from one city stree to another
- You can disable memory if you don't want to use it


### Built-In Stores
- Local disk store: [`SkillDiskStore`](./src/agent/skills/stores/diskStore.ts)
- MongoDB store: [`MongoDBSkillStore`](./src/agent/skills/stores/mongodbStore.ts)

You can also build custom stores by implementing [`SchemaSkillStore`](./src/agent/skills/stores/schema.ts).
