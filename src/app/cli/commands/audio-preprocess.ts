import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '@core/logger/index.js';

/**
 * Options for audio preprocessing
 */
export interface AudioPreprocessOptions {
  outputFormat?: 'wav' | 'flac' | 'mp3';
  sampleRate?: number;
  mono?: boolean;
  outputPath?: string;
}

/**
 * Preprocess an audio file for optimal speech-to-text performance
 * 
 * @param inputFile Path to the input audio file
 * @param options Preprocessing options
 * @returns Path to the processed audio file
 */
export async function preprocessAudio(
  inputFile: string,
  options: AudioPreprocessOptions = {}
): Promise<string> {
  // Check if ffmpeg is installed
  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      ffmpeg.on('error', () => {
        reject(new Error('ffmpeg is not installed or not in PATH'));
      });
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg check failed with code ${code}`));
        }
      });
    });
  } catch (error) {
    logger.error('FFmpeg is required for audio preprocessing. Please install it first.');
    throw error;
  }

  // Set default options
  const {
    outputFormat = 'flac',
    sampleRate = 16000,
    mono = true,
    outputPath,
  } = options;

  // Validate input file
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  // Determine output file path
  const inputFileName = path.basename(inputFile, path.extname(inputFile));
  const outputFile = outputPath || 
    path.join(path.dirname(inputFile), `${inputFileName}_processed.${outputFormat}`);

  // Build ffmpeg command
  const args = [
    '-i', inputFile,
    '-ar', sampleRate.toString(),
  ];

  // Add mono option if requested
  if (mono) {
    args.push('-ac', '1');
  }

  // Map audio stream
  args.push('-map', '0:a');

  // Set codec based on format
  if (outputFormat === 'flac') {
    args.push('-c:a', 'flac');
  } else if (outputFormat === 'wav') {
    args.push('-c:a', 'pcm_s16le');
  } else if (outputFormat === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
  }

  // Add output file
  args.push(outputFile);

  logger.info(`Preprocessing audio file: ${inputFile}`);
  logger.info(`Output format: ${outputFormat}, Sample rate: ${sampleRate}Hz, Mono: ${mono}`);

  // Run ffmpeg
  return new Promise<string>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.info(`Audio preprocessing complete: ${outputFile}`);
        resolve(outputFile);
      } else {
        logger.error(`ffmpeg failed with code ${code}`);
        logger.error(stderr);
        reject(new Error(`ffmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      logger.error(`ffmpeg error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * CLI command handler for audio preprocessing
 */
export async function preprocessCommand(
  inputFile: string,
  options: {
    format?: 'wav' | 'flac' | 'mp3';
    sampleRate?: number;
    stereo?: boolean;
    output?: string;
  }
): Promise<string> {
  try {
    const outputFile = await preprocessAudio(inputFile, {
      outputFormat: options.format,
      sampleRate: options.sampleRate,
      mono: !options.stereo,
      outputPath: options.output,
    });
    
    return outputFile;
  } catch (error) {
    logger.error(`Audio preprocessing error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
} 