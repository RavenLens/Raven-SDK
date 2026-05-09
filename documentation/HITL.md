# Human-In-The-Loop
Human-In-The-Loop (HITL) lets the agent ask the user for tool usage confirmation, information confirmation or missing information before continuing.

When HITL is active, agent execution waits for user input wherever HITL is required.

## How HITL Works
HITL currently supports two interaction types.

1. Tool approval
- Before executing selected tools, the agent asks the user for permission.
- Allowed answers are allow or deny.
- If delay rules are configured for a tool, a default answer can be applied after a timeout.
- Tool approvals are requested in parallel for all configured tool calls in the same step, and the step is blocked until all approvals are resolved.

2. User questions
- The agent can ask the user for information when context is missing.
- Question modes:
- Single-choice question (abc-style): user selects one option like a, b, c.
- Open question: user responds with free text.

## Transport
Currently supported transport:

- Socket.io transport via HITLSocketIo.

## ReAct Agent and HITL
Use HITL by creating a HITLSocketIo instance and passing it to the ReAct Agent configuration.

Example:

```typescript
import { ReActAgent } from "raven-adk/agents";
import { HITLSocketIo } from "raven-adk/tools/hitl";

const hitl = new HITLSocketIo({
    port: 3000,
    questions: {
        abcQuestion: {
            instruction: "Use short single-choice questions when user intent is ambiguous.",
            maxAnswersRange: ["a", "b", "c", "d"]
        },
        openQuestion: {
            instruction: "Use open question only when choices cannot represent valid outcomes."
        }
    },
    toolsUsage: {
        transfer_money: {
            delayMs: 30_000,
            defaultAnswer: "deny"
        },
        delete_account: true
    }
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a careful assistant.",
    messages: [{ type: "user", content: "Handle my request safely" }],
    tools,
    hitl
});
```

### Questioning behavior
When question tools are enabled in questions config:

- The agent receives dedicated HITL tools for abc and open questions.
- The prompt guidance tells the model to ask only when truly required.
- This prevents unnecessary user interruptions and keeps the flow focused.

### Tool approval behavior
When toolsUsage includes a tool name:

- That tool call requires HITL approval before execution.
- If denied, the tool call is not executed and the denial is returned to the agent loop.
- If delay fallback is configured, fallback answer is used when timeout is reached.

Tip: enable approvals only for risky or irreversible operations so users are protected without excessive prompts.
