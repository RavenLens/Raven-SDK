# Human-In-The-Loop
Allows to ask you whether action is permitted to be called or not

> Agent actions are delayed till HITL call will be resolved

## Types of HITL actions
* Tool call apporval - user is asked whether can agent call specific tool before it will be called - agent execution is executed till the answer
    * Can be setup delay with default option - when user doesn't asnwer in specific time
    * User has to specify a tools for what htil has to be called by utilizing tool name and default agreement option with delay as optional parameters if user has time to answer
    * User possilbe answers: ["allow", "deny"]
* Questions - agent can ask user a question before going further - this is going to improve agent accuracy especially when agent hasn't got something available in its context
    * Types of Questions:
        - a/b/c/d/... - user has to specify and answer for question with specific mode
            * User can give only one option as answer e.g: 'a'
        - open question - user has to type answer to llm

## Types of Transport
* Socket.io - Transport agent HITL via this transport 
