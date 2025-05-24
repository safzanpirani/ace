import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';

/**
 * Available Groq Speech-to-Text models
 */
export type GroqSpeechModel =
  | 'whisper-large-v3-turbo'
  | 'distil-whisper-large-v3-en'
  | 'whisper-large-v3';

/**
 * Options for Groq transcription requests
 */
export interface GroqTranscriptionOptions {
  model: GroqSpeechModel;
  file: string | Buffer; // File path or Buffer
  language?: string;
  prompt?: string;
  response_format?: 'json' | 'verbose_json' | 'text';
  temperature?: number;
  timestamp_granularities?: ('word' | 'segment')[];
}

/**
 * Options for Groq translation requests
 */
export interface GroqTranslationOptions {
  model: 'whisper-large-v3'; // Only whisper-large-v3 supports translation
  file: string | Buffer; // File path or Buffer
  prompt?: string;
  response_format?: 'json' | 'verbose_json' | 'text';
  temperature?: number;
}

/**
 * Result of a Groq transcription or translation request
 */
export interface GroqTranscriptionResult {
  text: string;
  [key: string]: any; // Additional fields when using verbose_json
}

/**
 * Transcribe audio to text using Groq's Speech-to-Text API
 * 
 * @param options Transcription options
 * @returns Transcription result
 */
export async function transcribeWithGroq(
  options: GroqTranscriptionOptions
): Promise<GroqTranscriptionResult> {
  const {
    model,
    file,
    language,
    prompt,
    response_format = 'json',
    temperature = 0,
    timestamp_granularities,
  } = options;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const form = new FormData();
  
  // Handle file input (path string or buffer)
  if (typeof file === 'string') {
    // Check if file exists
    if (!fs.existsSync(file)) {
      throw new Error(`Audio file not found: ${file}`);
    }
    form.append('file', fs.createReadStream(file), {
      filename: path.basename(file),
    });
  } else if (Buffer.isBuffer(file)) {
    form.append('file', file, {
      filename: 'audio.mp3', // Default filename
    });
  } else {
    throw new Error('Invalid file input: must be a file path or Buffer');
  }

  // Add required and optional parameters
  form.append('model', model);
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  form.append('response_format', response_format);
  form.append('temperature', temperature.toString());
  
  // Add timestamp granularities if specified and using verbose_json
  if (timestamp_granularities && response_format === 'verbose_json') {
    for (const granularity of timestamp_granularities) {
      form.append('timestamp_granularities[]', granularity);
    }
  }

  try {
    logger.debug(`Sending transcription request to Groq API with model: ${model}`);
    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${apiKey}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      logger.error(`Groq API error (${statusCode}): ${errorMessage}`);
      throw new Error(`Groq API error (${statusCode}): ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Translate audio to English text using Groq's Speech-to-Text API
 * 
 * @param options Translation options
 * @returns Translation result
 */
export async function translateWithGroq(
  options: GroqTranslationOptions
): Promise<GroqTranscriptionResult> {
  const {
    model,
    file,
    prompt,
    response_format = 'json',
    temperature = 0,
  } = options;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const form = new FormData();
  
  // Handle file input (path string or buffer)
  if (typeof file === 'string') {
    // Check if file exists
    if (!fs.existsSync(file)) {
      throw new Error(`Audio file not found: ${file}`);
    }
    form.append('file', fs.createReadStream(file), {
      filename: path.basename(file),
    });
  } else if (Buffer.isBuffer(file)) {
    form.append('file', file, {
      filename: 'audio.mp3', // Default filename
    });
  } else {
    throw new Error('Invalid file input: must be a file path or Buffer');
  }

  // Add required and optional parameters
  form.append('model', model);
  if (prompt) form.append('prompt', prompt);
  form.append('response_format', response_format);
  form.append('temperature', temperature.toString());
  form.append('language', 'en'); // Translations are always to English

  try {
    logger.debug(`Sending translation request to Groq API with model: ${model}`);
    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/translations',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${apiKey}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      logger.error(`Groq API error (${statusCode}): ${errorMessage}`);
      throw new Error(`Groq API error (${statusCode}): ${errorMessage}`);
    }
    throw error;
  }
} 