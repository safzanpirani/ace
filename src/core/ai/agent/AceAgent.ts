// src/ai/agent/AceAgent.ts
import { MCPClientManager } from '../../client/manager.js';
import { ILLMService } from '../llm/services/types.js';
import { PromptManager } from '../systemPrompt/manager.js';
import { MessageManager } from '../llm/messages/manager.js';
import { ConfigManager } from '../../config/manager.js';
import { EventEmitter } from 'events';
import { AgentServices } from '../../utils/service-initializer.js';
import { logger } from '../../logger/index.js';
import { McpServerConfig } from '../../config/schemas.js';
import { ImageData } from '../llm/messages/types.js';

const requiredServices: (keyof AgentServices)[] = [
    'clientManager',
    'promptManager',
    'llmService',
    'agentEventBus',
    'messageManager',
    'configManager',
];

/**
 * The main entry point into Ace's core.
 * AceAgent is an abstraction layer on top of the internal services that ace has.
 * You can use the AceAgent class in applications to build AI Agents.
 * By design, most of the methods in this class are thin wrappers around the internal services, exposing functionality that we might want to use in applications.
 */
export class AceAgent {
    /**
     * These services are public for use by the outside world
     * This gives users the option to use methods of the services directly if they know what they are doing
     * But the main recommended entry points/functions would still be the wrapper methods we define below
     */
    public readonly clientManager: MCPClientManager;
    public readonly promptManager: PromptManager;
    public readonly llmService: ILLMService;
    public readonly agentEventBus: EventEmitter;
    public readonly messageManager: MessageManager;
    public readonly configManager: ConfigManager;

    constructor(services: AgentServices) {
        // Validate all required services are provided
        for (const service of requiredServices) {
            if (!services[service]) {
                throw new Error(`Required service ${service} is missing in AceAgent constructor`);
            }
        }

        this.clientManager = services.clientManager;
        this.promptManager = services.promptManager;
        this.llmService = services.llmService;
        this.agentEventBus = services.agentEventBus;
        this.messageManager = services.messageManager;
        this.configManager = services.configManager;

        logger.info('AceAgent initialized.');
    }

    /**
     * Runs a task with the LLM service and returns the result.
     * This is the main entry point for using the agent.
     *
     * @param userInput The user's input text
     * @param imageData Optional image data to include with the message
     * @param streamingEnabled Whether to use streaming mode (default: false)
     * @returns The LLM's response text, or void if streaming is enabled
     */
    async run(
        userInput: string,
        imageData?: ImageData,
        streamingEnabled: boolean = false
    ): Promise<string | void> {
        try {
            logger.info(
                `Running task: "${userInput.substring(0, 50)}${userInput.length > 50 ? '...' : ''}"`
            );

            if (streamingEnabled) {
                await this.llmService.completeTaskStreaming(userInput, imageData);
                return;
            } else {
                const response = await this.llmService.completeTask(userInput, imageData);
                return response;
            }
        } catch (error) {
            logger.error('Error during AceAgent.run:', error);
            // Re-throw the error to allow the caller to handle it.
            throw error;
        }
    }

    /**
     * Runs a task with the LLM service using streaming mode.
     * This is a convenience method that calls run with streamingEnabled set to true.
     *
     * @param userInput The user's input text
     * @param imageData Optional image data to include with the message
     */
    async runStreaming(userInput: string, imageData?: ImageData): Promise<void> {
        return this.run(userInput, imageData, true) as Promise<void>;
    }

    /**
     * Resets the conversation history.
     */
    public resetConversation(): void {
        try {
            this.llmService.resetConversation();
            logger.info('AceAgent conversation reset.');
            this.agentEventBus.emit('ace:conversationReset');
        } catch (error) {
            logger.error('Error during AceAgent.resetConversation:', error);
            // Re-throw the error to allow the caller to handle it.
            throw error;
        }
    }

    /**
     * Connects a new MCP server dynamically.
     * @param name The name of the server to connect.
     * @param config The configuration object for the server.
     */
    public async connectMcpServer(name: string, config: McpServerConfig): Promise<void> {
        try {
            await this.clientManager.connectServer(name, config);
            this.agentEventBus.emit('ace:mcpServerConnected', { name, success: true });
            this.agentEventBus.emit('ace:availableToolsUpdated');
            logger.info(`AceAgent: Successfully connected to MCP server '${name}'.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`AceAgent: Failed to connect to MCP server '${name}': ${errorMessage}`);
            this.agentEventBus.emit('ace:mcpServerConnected', {
                name,
                success: false,
                error: errorMessage,
            });
            throw error;
        }
    }

    // Future methods could encapsulate more complex agent behaviors:
    // - public async startInteractiveCliSession() { /* ... */ }
    // - public async executeHeadlessCommand(command: string) { /* ... */ }
    // - public async specializedTask(params: any) { /* ... */ }
}
