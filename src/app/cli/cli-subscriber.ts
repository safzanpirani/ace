import { logger } from '@core/index.js';
import boxen from 'boxen';
import chalk from 'chalk';
import { EventSubscriber } from '../api/types.js';
import { EventEmitter } from 'events';

/**
 * Wrapper class to store methods describing how the CLI should handle agent events
 *
 * Minimum expected event handler methods (for LLMService events)
 *   - onThinking(): void
 *   - onChunk(text: string): void
 *   - onToolCall(toolName: string, args: any): void
 *   - onToolResult(toolName: string, result: any): void
 *   - onResponse(text: string): void
 *   - onError(error: Error): void
 *   - onConversationReset(): void
 */
export class CLISubscriber implements EventSubscriber {
    private accumulatedResponse: string = '';
    private currentLines: number = 0;
    private isFirstChunk: boolean = true;
    private updateInterval: NodeJS.Timeout | null = null;
    private lastUpdateTime: number = 0;
    private pendingUpdate: boolean = false;

    subscribe(eventBus: EventEmitter): void {
        eventBus.on('llmservice:thinking', this.onThinking.bind(this));
        eventBus.on('llmservice:chunk', this.onChunk.bind(this));
        eventBus.on('llmservice:toolCall', this.onToolCall.bind(this));
        eventBus.on('llmservice:toolResult', this.onToolResult.bind(this));
        eventBus.on('llmservice:response', this.onResponse.bind(this));
        eventBus.on('llmservice:error', this.onError.bind(this));
        eventBus.on('llmservice:conversationReset', this.onConversationReset.bind(this));
        eventBus.on('llmservice:resetAccumulation', this.onResetAccumulation.bind(this));
    }

    onThinking(): void {
        // If we have accumulated response, finalize it first
        if (this.accumulatedResponse.trim()) {
            // Clean up any duplicate text in the accumulated response
            const cleanedResponse = this.cleanDuplicateText(this.accumulatedResponse);

            // Generate the new box with the accumulated response
            const box = boxen(chalk.white(cleanedResponse), {
                padding: 1,
                borderColor: 'yellow',
                title: '🤖 AI Response (Partial)',
                titleAlignment: 'center',
            });

            // Move cursor up to the start of the previous box (if it exists)
            if (this.currentLines > 0) {
                process.stdout.write(`\x1b[${this.currentLines}A`);
                process.stdout.write(`\x1b[J`); // Clear from cursor to end of screen
            }

            // Print the finalized box
            console.log(box);
        }

        // Reset state for a new response
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.isFirstChunk = true;
        this.pendingUpdate = false;

        // Clear any existing update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Set up the update interval for smooth rendering
        this.updateInterval = setInterval(() => {
            if (this.pendingUpdate) {
                this.renderAccumulatedResponse();
                this.pendingUpdate = false;
            }
        }, 100); // Update at most 10 times per second

        logger.info('🤔 Ace is thinking...');
    }

    onChunk(text: string): void {
        // Check if this chunk is already in the accumulated response
        // This prevents duplicate text when chunks overlap
        if (this.accumulatedResponse.endsWith(text)) {
            // Skip this chunk as it's already in the accumulated response
            return;
        }

        // Append the new chunk to the accumulated response
        this.accumulatedResponse += text;

        // Mark that we have an update pending
        this.pendingUpdate = true;

        // If this is the first chunk, render immediately
        if (this.isFirstChunk) {
            this.isFirstChunk = false;
            this.renderAccumulatedResponse();
            this.pendingUpdate = false;
        } else {
            // Otherwise, throttle updates to avoid flickering
            const now = Date.now();
            if (now - this.lastUpdateTime > 100) {
                // At most 10 updates per second
                this.renderAccumulatedResponse();
                this.pendingUpdate = false;
            }
        }
    }

    private renderAccumulatedResponse(): void {
        // Clean up any duplicate text before rendering
        const cleanedResponse = this.cleanDuplicateText(this.accumulatedResponse);

        // Generate the new box with the cleaned accumulated response
        const box = boxen(chalk.white(cleanedResponse), {
            padding: 1,
            borderColor: 'yellow',
            title: '🤖 AI Response',
            titleAlignment: 'center',
        });

        // Count the number of lines in the new box
        const newLines = box.split('\n').length;

        // Move cursor up to the start of the previous box (if it exists)
        if (this.currentLines > 0) {
            process.stdout.write(`\x1b[${this.currentLines}A`);
            process.stdout.write(`\x1b[J`); // Clear from cursor to end of screen
        }

        // Print the new box (this overwrites the old one)
        process.stdout.write(box);

        // Update the line count
        this.currentLines = newLines;

        // Move cursor to the end of the box to allow logs below
        process.stdout.write('\n');

        // Update the last update time
        this.lastUpdateTime = Date.now();
    }

    onToolCall(toolName: string, args: any): void {
        // Clear any existing update interval when a tool is called
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // First, finalize the current accumulated response if there is one
        if (this.accumulatedResponse.trim()) {
            // Clean up any duplicate text in the accumulated response
            const cleanedResponse = this.cleanDuplicateText(this.accumulatedResponse);

            // Generate the new box with the accumulated response
            const box = boxen(chalk.white(cleanedResponse), {
                padding: 1,
                borderColor: 'yellow',
                title: '🤖 AI Response (Partial)',
                titleAlignment: 'center',
            });

            // Move cursor up to the start of the previous box (if it exists)
            if (this.currentLines > 0) {
                process.stdout.write(`\x1b[${this.currentLines}A`);
                process.stdout.write(`\x1b[J`); // Clear from cursor to end of screen
            }

            // Print the finalized box
            console.log(box);
        }

        // Reset accumulated response when switching to tool calls
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.isFirstChunk = true;
        this.pendingUpdate = false;

        // Display tool call information in a formatted box
        const formattedArgs = JSON.stringify(args, null, 2);
        const toolCallBox = boxen(
            chalk.cyan(`Tool Name: ${toolName}\n\nArguments:\n${chalk.white(formattedArgs)}`),
            {
                padding: 1,
                borderColor: 'cyan',
                title: '🔧 Tool Call',
                titleAlignment: 'center',
            }
        );
        console.log(toolCallBox);

        logger.debug(`Tool arguments: ${formattedArgs}`);
    }

    onToolResult(toolName: string, result: any): void {
        // Display tool result information in a formatted box
        const formattedResult = JSON.stringify(result, null, 2);
        const toolResultBox = boxen(
            chalk.green(`Tool Name: ${toolName}\n\nResult:\n${chalk.white(formattedResult)}`),
            {
                padding: 1,
                borderColor: 'green',
                title: '✅ Tool Result',
                titleAlignment: 'center',
            }
        );
        console.log(toolResultBox);

        logger.debug(`Tool result: ${formattedResult}`);
    }

    onResponse(text: string): void {
        logger.debug(
            `[CLISubscriber.onResponse] Incoming text: "${text}" | accumulatedResponse: "${this.accumulatedResponse}"`
        );
        // Clear the update interval since we have the final response
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // If rendering was ongoing (i.e., we have an accumulatedResponse from chunks)
        // that means renderAccumulatedResponse has already displayed the latest state.
        // The `text` parameter here might be a full concatenation from a higher level.
        // We want to ensure the final box shown is based on the last streamed segment.
        if (this.accumulatedResponse.trim()) {
            // Finalize the rendering of the last accumulated segment if there were pending updates.
            if (this.pendingUpdate) {
                this.renderAccumulatedResponse(); // This uses this.accumulatedResponse
            }
            // The box is already showing the correct last segment from renderAccumulatedResponse.
            // We just need to reset state for the next interaction.
            logger.debug(
                `[CLISubscriber.onResponse] Finalizing based on accumulated stream: "${this.accumulatedResponse}"`
            );
            this.accumulatedResponse = '';
            this.currentLines = 0;
            this.pendingUpdate = false;
            this.isFirstChunk = true; // Reset for next stream
            return;
        }

        // If there was no accumulatedResponse (e.g., a very short response that didn't trigger onChunk, or streaming is disabled/failed upstream)
        // then we rely on the incoming `text`.
        logger.debug(
            `[CLISubscriber.onResponse] No accumulated stream, using provided text: "${text}"`
        );
        const cleanedText = this.cleanDuplicateText(text);

        // Clear any previous box drawn by renderAccumulatedResponse if any (though currentLines should be 0 here)
        if (this.currentLines > 0) {
            process.stdout.write(`\x1b[${this.currentLines}A`);
            process.stdout.write(`\x1b[J`);
        }

        logger.displayAIResponse({ content: cleanedText });

        // Reset state
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.pendingUpdate = false;
        this.isFirstChunk = true;
    }

    /**
     * Clean up duplicate text that might appear in the final response
     * This handles cases where the same text appears multiple times due to streaming issues
     */
    private cleanDuplicateText(text: string): string {
        if (!text) return '';

        // Step 1: Handle simple, immediate, whole-string duplications
        // e.g., "Okay.Okay." -> "Okay." or "HelloHello" -> "Hello"
        // This is a basic check for a common streaming artifact.
        const halfLength = Math.floor(text.length / 2);
        if (text.length > 1 && text.length % 2 === 0) {
            const firstHalf = text.substring(0, halfLength);
            const secondHalf = text.substring(halfLength);
            if (firstHalf === secondHalf) {
                text = firstHalf; // Keep only the first half
            }
        }

        // Step 2: More sophisticated cleaning based on sentence/fragment duplication
        // Split the text into sentences or fragments
        const fragments = text.split(/(?<=[.!?])\\s+/);

        if (fragments.length <= 1 && !text.includes('\\n')) {
            // Also check for newlines for multi-line simple text
            // If only one fragment (or simple multi-line text without clear sentence breaks),
            // and it passed the immediate duplication check, return as is.
            return text;
        }

        // Check for and remove duplicated fragments
        const uniqueFragments: string[] = [];
        const seen = new Set<string>();

        for (const fragment of fragments) {
            const normalized = fragment.trim().toLowerCase();
            // Skip empty fragments
            if (normalized.length === 0) continue;

            // If this is a new fragment, add it
            if (!seen.has(normalized)) {
                seen.add(normalized);
                uniqueFragments.push(fragment);
            } else {
                // If we've seen this fragment, and it's identical to the last added unique fragment,
                // it's likely a direct repetition we want to avoid.
                if (
                    uniqueFragments.length > 0 &&
                    uniqueFragments[uniqueFragments.length - 1].trim().toLowerCase() === normalized
                ) {
                    // Don't add it again
                    logger.silly(`[cleanDuplicateText] Skipping repeated fragment: "${fragment}"`);
                } else {
                    // It's a repeat, but not an immediate one, so allow it (e.g. "Yes. No. Yes.")
                    seen.add(normalized); // Re-add to allow non-consecutive repeats if necessary
                    uniqueFragments.push(fragment);
                }
            }
        }

        // Rejoin the unique fragments
        return uniqueFragments.join(' ').trim();
    }

    onError(error: Error): void {
        // Clear the update interval if there's an error
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Clear any partial response state
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.pendingUpdate = false;

        logger.error(`❌ Error: ${error.message}`, null, 'red');
    }

    onConversationReset(): void {
        // Clear the update interval if the conversation is reset
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Clear any partial response state
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.pendingUpdate = false;

        logger.info('🔄 Conversation history cleared.', null, 'blue');
    }

    onResetAccumulation(): void {
        // Reset accumulated response when requested (e.g., after tool calls)
        this.accumulatedResponse = '';
        this.currentLines = 0;
        this.isFirstChunk = true;

        // Clear any existing update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}
