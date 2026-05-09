import { createServer } from "http";
import * as z from "zod";
import { Server, Socket } from "socket.io";
import { DEFAULT_ABC_ANSWERS_RANGE, HITLConfigSchema, HITLToolAllowancePossibleAnswer, HITLTransportSchema } from "../hitlToolSchema";
import { tool, Tool } from "../../tools";

const DEFAULT_SOCKETIO_PORT = 3000;
const HITL_ABC_QUESTION_TOOL_NAME = "hitl_ask_abc_question";
const HITL_OPEN_QUESTION_TOOL_NAME = "hitl_ask_open_question";

interface SocketIOHITLConfig extends HITLConfigSchema {
    /**
     * As default listens on port `3000`
     */
    port?: number;
    /**
     * List with middlewares.
     * Use e.g to:
     *  - make authentication
     * 
     * 
     * Will be specified as following:
     * ```typescript
     * import { createServer } from "http";
     * import { Server } from "socket.io";
     * 
     * const httpServer = createServer();
     * const io = new Server(httpServer);
     * 
     * io.use((socket, next) => {
     *   // ... logic
     *   next()
     * })
     * 
     * io.on("connection", (socket) => {
     *      // ...
     * });
     *  
     * httpServer.listen(3000);
     * 
     * ```
     */
    socketServerMiddleware?: Parameters<Server["use"]>[0][];
    /**
     * List with socket.io Socket middleware functions
     * 
     * Examples of usage:
     * ```typescript
     * io.on("connection", (socket: Socket) => {
     *      // ...
     *      socket.use((event, next) => {
     *          // ... Middleware logic
     *      })
     * });
     * ```
     */
    socketConnectionMiddleware?: Parameters<Socket["use"]>[0][];
}

type HITLEvents = keyof NonNullable<HITLConfigSchema["questions"]> | keyof Pick<NonNullable<HITLConfigSchema>, "toolsUsage">

export class HITLSocketIo implements HITLTransportSchema {
    private connectionSocket: Socket | undefined = undefined;
    questionHITLPrompt: string;
    config: SocketIOHITLConfig;
    
    constructor(config: HITLConfigSchema) {
        this.config = config;
        this.questionHITLPrompt = this.buildQuestionPrompt();
        this.runServer();
    }

    private buildQuestionPrompt() {
        const abcInstruction = typeof this.config.questions?.abcQuestion === "object"
            ? this.config.questions.abcQuestion.instruction
            : undefined;
        const openInstruction = typeof this.config.questions?.openQuestion === "object"
            ? this.config.questions.openQuestion.instruction
            : undefined;

        return [
            "[HITL Questioning Rules]",
            "Use HITL questioning tools only when it is strictly required to continue the task safely or accurately.",
            "Do not overwhelm the user with questions. Ask only when key information is missing and cannot be inferred from context or tool outputs.",
            "Ask one focused question at a time and keep each question concise.",
            `Use \"${HITL_ABC_QUESTION_TOOL_NAME}\" for constrained choices where options are known in advance.${abcInstruction ? ` Additional abc guidance: ${abcInstruction}` : ""}`,
            `Use \"${HITL_OPEN_QUESTION_TOOL_NAME}\" only when fixed options are not sufficient.${openInstruction ? ` Additional open-question guidance: ${openInstruction}` : ""}`
        ].join("\n");
    }

    private runServer() {
        const httpServer = createServer();
        const io = new Server(httpServer);

        if (this.config.socketServerMiddleware) {
            this.config.socketServerMiddleware.forEach(middleware => {
                io.use(middleware);
            })
        }
        
        io.on("connection", (socket: Socket) => {
            // Define middlewares
            if (this.config.socketConnectionMiddleware) {
                this.config.socketConnectionMiddleware.forEach(middleware => {
                    socket.use(middleware);
                })
            }

            // Logic of HITL -> User has to answer in callback in each of `emit...` functions
            this.connectionSocket = socket;
        });
        
        httpServer.listen(this.config.port || DEFAULT_SOCKETIO_PORT);
    }

    emitAbcQuestion(question: string, abcOptions: [string, string][]) {
        return new Promise<[string, string]>((res, rej) => {
            if (!this.connectionSocket) {
                return rej("Cannot emit \"abcQuestion\" because socket.io connection isn't defined");
            }

            // Verify is the abc in range
            const optionsFromParam = abcOptions.map(([letterOption, question]) => {
                return letterOption;
            });
            const allowedOptions = typeof this.config.questions?.abcQuestion === "object" ? this.config.questions?.abcQuestion.maxAnswersRange : DEFAULT_ABC_ANSWERS_RANGE
            const areInSquare = optionsFromParam.every(option => allowedOptions?.includes(option));

            if (!areInSquare) {
                return rej("options_not_in_range");
            }
            
            // Emits
            this.connectionSocket.emit(
                "abcQuestion" as HITLEvents,
                question,
                abcOptions,
                (answer: [string, string]) => {
                    res(answer);
                }
            );
        })
    }

    emitOpenQuestion(question: string) {
        return new Promise<string>((res, rej) => {
            if (!this.connectionSocket) {
                return rej("Cannot emit \"openQuestion\" because socket.io connection isn't defined");
            }
            
            this.connectionSocket.emit(
                "openQuestion" as HITLEvents,
                question,
                (answer: string) => {
                    res(answer);
                }
            );
        });
    }

    emitToolUsage(toolName: string) {
        return new Promise<{ answer: HITLToolAllowancePossibleAnswer; reason: "user_answer" | "delay_pass" }>((res, rej) => {
            let isAnswer = false;
            
            if (!this.connectionSocket) {
                return rej("Cannot emit \"toolsUsage\" because socket.io connection isn't defined");
            }

            // Emit handling
            this.connectionSocket.emit(
                "toolsUsage" as HITLEvents,
                toolName,
                (allowanceAnswer: HITLToolAllowancePossibleAnswer) => {
                    if (!isAnswer) {
                        isAnswer = true;
                        return res({ answer: allowanceAnswer, reason: "user_answer" });
                    }
                }
            );

            // Delay handling -> when passed
            if (this.config.toolsUsage && typeof this.config.toolsUsage[toolName] === "object") {
                setTimeout(() => {
                    if (!isAnswer && typeof this.config.toolsUsage?.[toolName] === "object") {
                        isAnswer = true;
                        return res({
                            answer: this.config.toolsUsage[toolName].defaultAnswer,
                            reason:"delay_pass"
                        })
                    }
                }, this.config.toolsUsage[toolName].delayMs)
            }
        });
    }

    createQuestionTools(): Tool<any, any>[] {
        const questionTools: Tool<any, any>[] = [];
        const canAskAbcQuestion = !!this.config.questions?.abcQuestion;
        const canAskOpenQuestion = !!this.config.questions?.openQuestion;

        if (canAskAbcQuestion) {
            questionTools.push(
                tool(
                    async ({ question, options }) => {
                        const answer = await this.emitAbcQuestion(question, options);

                        return JSON.stringify({
                            option: answer[0],
                            optionLabel: answer[1]
                        });
                    },
                    {
                        toolName: HITL_ABC_QUESTION_TOOL_NAME,
                        toolDescription: "Ask user a single-choice HITL question with predefined options and wait for answer.",
                        toolArguments: z.object({
                            question: z.string().min(1).describe("Question text shown to user. Keep it short and specific to one decision."),
                            options: z.array(
                                z.tuple([
                                    z.string().min(1).describe("Option key used by user selection, usually a single letter like a/b/c."),
                                    z.string().min(1).describe("Option label shown to user as the meaning of the key.")
                                ]).describe("A single selectable option tuple in format [optionKey, optionLabel].")
                            ).min(2).describe("Available single-select options passed to user.")
                        }),
                        toolOutputSchema: z.object({
                            option: z.string().describe("Selected option key returned by user."),
                            optionLabel: z.string().describe("Selected option label returned by user.")
                        })
                    }
                )
            );
        }

        if (canAskOpenQuestion) {
            questionTools.push(
                tool(
                    async ({ question }) => {
                        const answer = await this.emitOpenQuestion(question);

                        return JSON.stringify({
                            answer
                        });
                    },
                    {
                        toolName: HITL_OPEN_QUESTION_TOOL_NAME,
                        toolDescription: "Ask user an open HITL question and wait for a free-text answer.",
                        toolArguments: z.object({
                            question: z.string().min(1).describe("Open question text shown to user when predefined options are insufficient.")
                        }),
                        toolOutputSchema: z.object({
                            answer: z.string().describe("Free-text answer returned by user.")
                        })
                    }
                )
            );
        }

        return questionTools;
    }
}
