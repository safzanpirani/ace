import { MCPClientManager } from '../../../client/manager.js';
import { ILLMService, LLMServiceConfig } from './types.js';
import { logger } from '../../../logger/index.js';
import { streamText, generateText, CoreMessage, LanguageModelV1 } from 'ai';
import { ToolSet } from '../../types.js';
import { ToolSet as VercelToolSet, jsonSchema } from 'ai';
import { EventEmitter } from 'events';
import { MessageManager } from '../messages/manager.js';
import { getMaxTokensForModel } from '../registry.js';
import { ImageData } from '../messages/types.js';
import { ModelNotFoundError } from '../errors.js';

/**
 * Vercel implementation of LLMService
 */
export class VercelLLMService implements ILLMService {
    private model: LanguageModelV1;
    private provider: string;
    private clientManager: MCPClientManager;
    private messageManager: MessageManager;
    private eventEmitter: EventEmitter;
    private maxIterations: number;

    constructor(
        clientManager: MCPClientManager,
        model: LanguageModelV1,
        provider: string,
        agentEventBus: EventEmitter,
        messageManager: MessageManager,
        maxIterations: number
    ) {
        this.maxIterations = maxIterations;
        this.model = model;
        this.clientManager = clientManager;
        this.eventEmitter = agentEventBus;
        this.provider = provider;
        this.messageManager = messageManager;
        logger.debug(
            `[VercelLLMService] Initialized for model: ${this.model.modelId}, provider: ${this.provider}, messageManager: ${this.messageManager}`
        );
    }

    getAllTools(): Promise<ToolSet> {
        return this.clientManager.getAllTools();
    }

    formatTools(tools: ToolSet): VercelToolSet {
        logger.debug(`Formatting tools for vercel`);
        return Object.keys(tools).reduce<VercelToolSet>((acc, toolName) => {
            acc[toolName] = {
                description: tools[toolName].description,
                parameters: jsonSchema(tools[toolName].parameters as any),
                execute: async (args: any) => {
                    return await this.clientManager.executeTool(toolName, args);
                },
            };
            return acc;
        }, {});
    }

    async completeTask(userInput: string, imageData?: ImageData): Promise<string> {
        // Add user message, with optional image data
        this.messageManager.addUserMessage(userInput, imageData);

        // Get all tools
        const tools: any = await this.clientManager.getAllTools();
        logger.silly(
            `[VercelLLMService] Tools before formatting: ${JSON.stringify(tools, null, 2)}`
        );

        const formattedTools = this.formatTools(tools);
        logger.silly(
            `[VercelLLMService] Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`
        );

        let iterationCount = 0;
        let fullResponse = '';

        try {
            while (iterationCount < 1) {
                this.eventEmitter.emit('llmservice:thinking');
                iterationCount++;
                logger.debug(`Iteration ${iterationCount}`);

                // Get formatted messages from message manager
                const formattedMessages = await this.messageManager.getFormattedMessages({
                    clientManager: this.clientManager,
                });

                logger.debug(
                    `Messages (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
                );
                logger.silly(`Tools: ${JSON.stringify(formattedTools, null, 2)}`);

                // Estimate tokens before sending (optional)
                const currentTokens = this.messageManager.getTokenCount();
                logger.debug(`Estimated tokens being sent to Vercel provider: ${currentTokens}`);

                // Choose between generateText or processStream
                // generateText waits for the full response, processStream handles chunks
                fullResponse = await this.generateText(
                    formattedMessages,
                    formattedTools,
                    this.maxIterations
                );
                // OR
                // fullResponse = await this.processStream(formattedMessages, formattedTools, MAX_ITERATIONS);
            }

            return (
                fullResponse ||
                'Reached maximum number of tool call iterations without a final response.'
            );
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Vercel LLM service execution: ${errorMessage}`, { error });
            // Hint for token overflow
            logger.warn(
                `Possible token overflow encountered. If due to exceeding model's token limit, configure 'maxTokens' in your LLMConfig.`
            );
            this.eventEmitter.emit(
                'llmservice:error',
                error instanceof Error ? error : new Error(errorMessage)
            );
            return `Error processing request: ${errorMessage}`;
        }
    }

    async generateText(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 50
    ): Promise<string> {
        let stepIteration = 0;

        const response = await generateText({
            model: this.model,
            messages: messages,
            tools,
            onStepFinish: (step) => {
                logger.debug(`Step iteration: ${stepIteration}`);
                stepIteration++;
                logger.debug(`Step finished, step type: ${step.stepType}`);
                logger.debug(`Step finished, step text: ${step.text}`);
                logger.debug(
                    `Step finished, step tool calls: ${JSON.stringify(step.toolCalls, null, 2)}`
                );
                logger.debug(
                    `Step finished, step tool results: ${JSON.stringify(step.toolResults, null, 2)}`
                );

                if (step.text) {
                    this.eventEmitter.emit('llmservice:response', step.text);
                }
                // Emit events based on step content (kept from original)
                if (step.toolCalls && step.toolCalls.length > 0) {
                    for (const toolCall of step.toolCalls) {
                        this.eventEmitter.emit(
                            'llmservice:toolCall',
                            toolCall.toolName,
                            toolCall.args
                        );
                    }
                }
                if (step.toolResults && step.toolResults.length > 0) {
                    for (const toolResult of step.toolResults as any) {
                        this.eventEmitter.emit(
                            'llmservice:toolResult',
                            toolResult.toolName,
                            toolResult.result
                        );
                    }
                }
                // NOTE: Message manager additions are now handled after generateText completes
            },
            maxSteps: maxSteps,
        });

        // Parse and append each new InternalMessage from the formatter using MessageManager
        this.messageManager.processLLMResponse(response);
        // Return the plain text of the response
        return response.text;
    }

    async processStream(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10
    ): Promise<void> {
        const streamResult = await this.streamText(messages, tools, maxSteps);

        // The streamText method's onChunk, onStepFinish, and onFinish callbacks now handle all event emissions.
        // This loop is primarily to ensure the entire stream is consumed.
        // Chunks are emitted by `onChunk` in `streamText`.
        // Responses for segments are emitted by `onStepFinish` or `onFinish` in `streamText`.
        try {
            // Ensure streamResult and streamResult.textStream exist before iterating
            if (
                streamResult &&
                typeof streamResult.textStream === 'object' &&
                streamResult.textStream !== null &&
                typeof streamResult.textStream[Symbol.asyncIterator] === 'function'
            ) {
                for await (const _ of streamResult.textStream) {
                    // Consuming the stream. Actual data processing and event emission happen in streamText's callbacks.
                }
                logger.debug('[VercelLLMService.processStream] Stream fully consumed.');
            } else {
                logger.error(
                    '[VercelLLMService.processStream] streamResult.textStream is not an async iterable or is missing.',
                    { streamResult }
                );
                // Optionally emit an error if the stream is not as expected, though onError in streamText should catch SDK errors
                this.eventEmitter.emit(
                    'llmservice:error',
                    new Error('Vercel AI SDK stream is not iterable as expected.')
                );
            }
        } catch (error) {
            logger.error('[VercelLLMService.processStream] Error consuming stream:', error);
            this.eventEmitter.emit(
                'llmservice:error',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    // returns AsyncIterable<string> & ReadableStream<string>
    async streamText(
        messages: CoreMessage[],
        tools: VercelToolSet,
        maxSteps: number = 10
    ): Promise<any> {
        let stepIteration = 0;
        let currentSegmentText = ''; // Accumulate text for the current segment

        const streamResult = streamText({
            model: this.model,
            messages: messages,
            tools,
            onChunk: (chunk) => {
                logger.debug(`Chunk type: ${chunk.chunk.type}`);
                if (chunk.chunk.type === 'text-delta') {
                    const delta = chunk.chunk.textDelta;
                    if (delta) {
                        currentSegmentText += delta;
                        this.eventEmitter.emit('llmservice:chunk', delta);
                    }
                }
            },
            onError: (error) => {
                logger.error(`Error in streamText: ${JSON.stringify(error, null, 2)}`);
                this.eventEmitter.emit(
                    'llmservice:error',
                    error instanceof Error ? error : new Error(String(error))
                );
            },
            onStepFinish: (step) => {
                logger.debug(`Step iteration: ${stepIteration}, Type: ${step.stepType}`);
                stepIteration++;
                // logger.silly(`Detailed step object: ${JSON.stringify(step, null, 2)}`);

                let hasHandledThisStep = false;

                // Handle completed text segments first
                // A text segment is considered complete if step.text has content.
                if (step.text && step.text.trim() !== '') {
                    logger.debug(`Handling text segment: "${step.text}"`);
                    this.messageManager.addAssistantMessage(step.text); // Add to history
                    this.eventEmitter.emit('llmservice:response', step.text); // Emit this segment's response
                    currentSegmentText = ''; // Reset accumulator as this segment is done
                    hasHandledThisStep = true;
                }

                // Handle tool calls if present
                // These might occur with or without accompanying text in the same step object.
                if (step.toolCalls && step.toolCalls.length > 0) {
                    logger.debug(`Handling tool calls: ${JSON.stringify(step.toolCalls)}`);
                    // If there was preceding text that wasn't captured as a full step.text segment,
                    // and we haven't already handled a text segment for this step.
                    if (currentSegmentText.trim() && !hasHandledThisStep) {
                        logger.debug(
                            `Emitting preceding text before tool call: "${currentSegmentText}"`
                        );
                        this.messageManager.addAssistantMessage(currentSegmentText);
                        this.eventEmitter.emit('llmservice:response', currentSegmentText);
                    }
                    currentSegmentText = ''; // Reset for safety before tool call events
                    for (const toolCall of step.toolCalls) {
                        this.eventEmitter.emit(
                            'llmservice:toolCall',
                            toolCall.toolName,
                            toolCall.args
                        );
                    }
                    this.eventEmitter.emit('llmservice:resetAccumulation');
                    hasHandledThisStep = true;
                }

                // Handle tool results if present
                if (step.toolResults && step.toolResults.length > 0) {
                    logger.debug(`Handling tool results: ${JSON.stringify(step.toolResults)}`);
                    for (const toolResult of step.toolResults as any) {
                        this.eventEmitter.emit(
                            'llmservice:toolResult',
                            toolResult.toolName,
                            toolResult.result
                        );
                    }
                    currentSegmentText = ''; // Expect new text after tool results
                    hasHandledThisStep = true;
                }

                // If, after all checks, currentSegmentText still has content and this step wasn't handled as text,
                // it means chunks were received but no definitive step.text was provided for them.
                // This is a fallback, ideally step.text should be the primary way to confirm a text segment.
                if (currentSegmentText.trim() && !hasHandledThisStep) {
                    logger.debug(
                        `Fallback: Emitting remaining currentSegmentText: "${currentSegmentText}"`
                    );
                    this.messageManager.addAssistantMessage(currentSegmentText);
                    this.eventEmitter.emit('llmservice:response', currentSegmentText);
                    currentSegmentText = '';
                }
            },
            onFinish: (result) => {
                logger.debug(`Stream finished. Reason: ${result.finishReason}`);
                // Only emit if there is leftover text that hasn't been emitted as a segment
                if (currentSegmentText.trim()) {
                    logger.debug(`Finalizing text from onFinish: "${currentSegmentText}"`);
                    this.messageManager.addAssistantMessage(currentSegmentText);
                    this.eventEmitter.emit('llmservice:response', currentSegmentText);
                }
                currentSegmentText = ''; // Final reset
                // Log other details from result if needed
                // logger.silly(`onFinish result object: ${JSON.stringify(result, null, 2)}`);
            },
            maxSteps: maxSteps,
        });

        // The streamText function from Vercel AI SDK returns an object that includes the textStream.
        // We return the whole result so `processStream` can iterate over `result.textStream`.
        return streamResult;
    }

    resetConversation(): void {
        this.messageManager.reset();
        this.eventEmitter.emit('llmservice:conversationReset');
    }

    /**
     * Get configuration information about the LLM service
     * @returns Configuration object with provider and model information
     */
    getConfig(): LLMServiceConfig {
        const configuredMaxTokens = this.messageManager.getMaxTokens();
        let modelMaxTokens: number;

        // Fetching max tokens from LLM registry - default to configured max tokens if not found
        // Max tokens may not be found if the model is supplied by user
        try {
            modelMaxTokens = getMaxTokensForModel(this.provider, this.model.modelId);
        } catch (error) {
            // if the model is not found in the LLM registry, log and default to configured max tokens
            if (error instanceof ModelNotFoundError) {
                modelMaxTokens = configuredMaxTokens;
                logger.debug(
                    `Could not find model ${this.model.modelId} in LLM registry to get max tokens. Using configured max tokens: ${configuredMaxTokens}.`
                );
                // for any other error, throw
            } else {
                throw error;
            }
        }
        return {
            router: 'vercel',
            provider: `${this.provider}`,
            model: this.model,
            configuredMaxTokens: configuredMaxTokens,
            modelMaxTokens,
        };
    }

    /**
     * Process a user's task with streaming enabled.
     * Uses Vercel AI SDK's streamText function to stream responses.
     *
     * @param userInput The primary text input from the user.
     * @param imageData Optional image data associated with the user input.
     */
    async completeTaskStreaming(userInput: string, imageData?: ImageData): Promise<void> {
        // Add user message, with optional image data
        this.messageManager.addUserMessage(userInput, imageData);

        // Get all tools
        const tools: any = await this.clientManager.getAllTools();
        logger.silly(
            `[VercelLLMService] Tools before formatting: ${JSON.stringify(tools, null, 2)}`
        );

        const formattedTools = this.formatTools(tools);
        logger.silly(
            `[VercelLLMService] Formatted tools: ${JSON.stringify(formattedTools, null, 2)}`
        );

        try {
            // Notify thinking
            this.eventEmitter.emit('llmservice:thinking');

            // Get formatted messages from message manager
            const formattedMessages = await this.messageManager.getFormattedMessages({
                clientManager: this.clientManager,
            });

            logger.debug(
                `Messages (potentially compressed): ${JSON.stringify(formattedMessages, null, 2)}`
            );
            logger.silly(`Tools: ${JSON.stringify(formattedTools, null, 2)}`);

            // Estimate tokens before sending
            const currentTokens = this.messageManager.getTokenCount();
            logger.debug(`Estimated tokens being sent to Vercel provider: ${currentTokens}`);

            // Use the existing processStream method which already handles streaming
            await this.processStream(formattedMessages, formattedTools, this.maxIterations);
        } catch (error) {
            // Handle API errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error in Vercel LLM streaming: ${errorMessage}`, { error });
            logger.warn(
                `Possible token overflow encountered. If due to exceeding model's token limit, configure 'maxTokens' in your LLMConfig.`
            );
            this.eventEmitter.emit(
                'llmservice:error',
                error instanceof Error ? error : new Error(errorMessage)
            );
        }
    }
}
