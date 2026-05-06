1. Graph that supports:
    - Execution
        - Synchronous
        - Asynchronous
    - State - each node modifies state
    - Events - each node execution has to be comunicated as the event
        - node_start
        - node_end
        - node_state_change - when state has been changed
2. Agents built as default as:
    - ReAct Agent
        Gives support to:
        - System prompt - overall specification what has agent todo -> specified by the user - we give some wrapper atop of what user says
        - User prompt - the task given to agent todo
        - Multi-agents execution
        - Events Producing
        - GACP - Graph Agent communication protocol - communicate bevies of agents on graph
            - Build RavenLens platform atop of that
        - MCP (Model Context Protocol) - support from the fround point
        - A2A - agent communication protocol support for bevies of agents
        - ACP - agent communication protocol support for bevies of agents
        - Skills - explore and optionally create skills (when `creation: true`) -> done as the separate class
        - Tools 
            - Calling:
                - Local Tools calling
                - Remote tools calling - to support the tools
            - HITL - tool breaks all agents execution till use will give the answer
                - Has modes:
                    - A/B - user selects option
                    - Open - user types his answer
                - Has waiting period to be setup as optional option - when given llm will ignore prior given task
3. LLMs support
    - Give standalone RunPod support to execute open-source models
    - Support OpenAI
4. Chat messages support - remembers chat messages
    - User prompt
    - AI Answer
    - Tool usage