import fs from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';
import { transcribeWithGroq, translateWithGroq } from '@core/ai/llm/services/groq-speech.js';
import type { GroqSpeechModel } from '@core/ai/llm/services/groq-speech.js';

/**
 * Options for the transcribe command
 */
export interface TranscribeOptions {
  model?: GroqSpeechModel;
  language?: string;
  prompt?: string;
  verbose?: boolean;
  translate?: boolean;
  output?: string;
}

/**
 * Command handler for transcribing audio files
 * 
 * @param filePath Path to the audio file
 * @param options Command options
 * @returns The transcription result
 */
export async function transcribeCommand(filePath: string, options: TranscribeOptions) {
  try {
    // Validate file path
    if (!fs.existsSync(filePath)) {
      logger.error(`Audio file not found: ${filePath}`);
      return;
    }

    // Resolve absolute path
    const absolutePath = path.resolve(filePath);
    logger.info(`Processing audio file: ${absolutePath}`);

    // Default model selection
    const model = options.model || 'whisper-large-v3-turbo';
    
    let result;
    
    if (options.translate) {
      // Only whisper-large-v3 supports translation
      if (model !== 'whisper-large-v3' && model !== 'whisper-large-v3-turbo') {
        logger.warn(`Model ${model} does not support translation. Using whisper-large-v3 instead.`);
      }
      
      logger.info('Translating audio to English...');
      result = await translateWithGroq({
        model: 'whisper-large-v3',
        file: absolutePath,
        prompt: options.prompt,
        response_format: options.verbose ? 'verbose_json' : 'text',
        temperature: 0,
      });
    } else {
      logger.info(`Transcribing audio with model: ${model}`);
      result = await transcribeWithGroq({
        model,
        file: absolutePath,
        language: options.language,
        prompt: options.prompt,
        response_format: options.verbose ? 'verbose_json' : 'text',
        timestamp_granularities: options.verbose ? ['word', 'segment'] : undefined,
        temperature: 0,
      });
    }

    // Handle output
    if (options.output) {
      const outputPath = path.resolve(options.output);
      if (options.verbose) {
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      } else {
        fs.writeFileSync(outputPath, result.text);
      }
      logger.info(`Output saved to: ${outputPath}`);
    } else {
      // Print to console
      if (options.verbose) {
        console.dir(result, { depth: null });
      } else {
        console.log(result.text);
      }
    }

    return result;
  } catch (error) {
    logger.error(`Transcription error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
} 