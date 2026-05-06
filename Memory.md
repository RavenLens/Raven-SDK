# Memory
Memory in RavenADK agents provide you way to remember data from interactions with user and get them recalled in next iterations what makes vivid user interactions. Such informations can be manipulated via Memory: 
    - user name
    - user preferrences
    - user given task
    - user conversation style schema - it can be 
Finally you've full agency to decide what agent has to remember, what should so you decide the agent behaviour

## Controlling what agent can remember
<!-- TODO: Specify the snippet with code showcases: shouldRemmber, haveRemember with example instructions -> use the ReAct agent example as the pot for implementation -->

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
