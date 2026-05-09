import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { DEFAULT_ABC_ANSWERS_RANGE, HITLConfigSchema, ToolUsageConfObject } from "../hitlToolSchema";

const DEFAULT_SOCKETIO_PORT = 3000;

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

export class HITLSocketIo {
    private connectionSocket: Socket | undefined = undefined;
    config: SocketIOHITLConfig;
    
    constructor(config: HITLConfigSchema) {
        this.config = config;
        this.runServer();
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

            // Logic of HITL
            this.connectionSocket = socket;
        });
        
        httpServer.listen(this.config.port || DEFAULT_SOCKETIO_PORT);
    }

    /** TODO: Each option has to use separate methods
     * Add Delay for tool usage method and emit resolve after success
     * A/B/C - answer has to send to client letter with option
     * Open Question - has to send to user question
    */
    emitHITLToClient<Event extends HITLEvents, Option = Event extends "toolsUsage" ? ToolUsageConfObject : string | undefined>(event: Event, option?: Option) {
        return new Promise((res, rej) => {
            if (!this.connectionSocket) {
                console.error(`Cannot emit "${event}" because socket.io connection isn't defined`);
                return res(false);
            }
            
            if (event === "abcQuestion" && typeof this.config.questions?.abcQuestion === "object") {
                this.connectionSocket.emit(
                    event,
                    this.config.questions.abcQuestion.maxAnswersRange ?? DEFAULT_ABC_ANSWERS_RANGE,
                    (answer: string) => {
                        res(answer);
                    }
                );
            }
            else if (event === "openQuestion") {
                this.connectionSocket.emit(
                    event,
                    option ?? undefined,
                    (answer: string) => {
                        res(answer);
                    }
                );
            }
            else if (event === "toolsUsage") {
    
            }
            else {
                this.connectionSocket.emit(
                    event
                );
            }
        })
    }
}
