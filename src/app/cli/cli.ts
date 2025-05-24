import readline from 'readline';
import chalk from 'chalk';
import { logger } from '@core/index.js';
import { CLISubscriber } from './cli-subscriber.js';
import { AceAgent } from '@core/index.js';
import { transcribeCommand, TranscribeOptions } from './commands/transcribe.js';
import { preprocessCommand } from './commands/audio-preprocess.js';
import type { GroqSpeechModel } from '@core/ai/llm/services/groq-speech.js';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { transcribeWithGroq } from '@core/ai/llm/services/groq-speech.js';
import os from 'os';

const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const HELP_MESSAGE = `Available commands:
exit/quit - Exit the CLI
clear - Clear conversation history
help - Show this help message
currentloglevel - Show current logging level
${validLogLevels.join('|')} - Set logging level directly
transcribe <file> [options] - Transcribe an audio file using Groq Speech-to-Text
preprocess-audio <file> [options] - Preprocess audio for optimal transcription
voice - Toggle voice input mode (Ctrl+T to start/stop recording)
voice-device <name> - Set microphone device for voice input
voice-debug - Toggle debug mode for voice input (saves recordings)
voice-test - Record a short test clip to verify microphone setup
voice-detect - Auto-detect available microphones (Windows only)
`;

/**
 * Initializes common CLI setup: logging, event subscriptions, tool loading.
 * @param agent The AceAgent instance providing access to all required services
 */
async function _initCli(agent: AceAgent): Promise<void> {
    // Log model and connection info
    logger.info(
        `Using model config: ${JSON.stringify(agent.llmService.getConfig(), null, 2)}`,
        null,
        'yellow'
    );
    logger.debug(`Log level: ${logger.getLevel()}`);
    logger.info(`Connected servers: ${agent.clientManager.getClients().size}`, null, 'green');
    const failedConnections = agent.clientManager.getFailedConnections();
    if (Object.keys(failedConnections).length > 0) {
        logger.error(`Failed connections: ${Object.keys(failedConnections).length}.`, null, 'red');
    }

    // Set up event management
    logger.info('Setting up CLI event subscriptions...');
    const cliSubscriber = new CLISubscriber();
    cliSubscriber.subscribe(agent.agentEventBus);

    // Load available tools
    logger.info('Loading available tools...');
    try {
        const tools = await agent.clientManager.getAllTools(); // tools variable is not used currently but kept for potential future use
        logger.info(
            `Loaded ${Object.keys(tools).length} tools from ${
                agent.clientManager.getClients().size
            } MCP servers`
        );
    } catch (error) {
        logger.error(
            `Failed to load tools: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    logger.info('CLI initialized successfully. Ready for input.', null, 'green');

    // Display voice input tip
    if (process.env.GROQ_API_KEY) {
        logger.info('TIP: Type "voice" and press Enter to enable voice input mode', null, 'cyan');
        logger.info('     Then press Ctrl+T to start/stop recording your voice', null, 'cyan');
    }
}

/**
 * Run the AI CLI with the given LLM service
 * @param agent Ace agent instance
 */
export async function startAiCli(agent: AceAgent) {
    try {
        // Common initialization
        await _initCli(agent);

        // Create readline interface
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.bold.green('\nWhat would you like to do? '),
        });

        // Set up raw mode for keyboard shortcuts
        process.stdin.setRawMode(true);

        // Flag to track if we're currently recording
        let isRecording = false;
        let recordingProcess: any = null;
        let voiceInputEnabled = false;
        let voiceDebugMode = false;
        let microphoneDevice: string | null = null;
        const tempDir = os.tmpdir();
        const recordingFile = path.join(tempDir, 'ace_recording.wav');

        // Determine default audio input format and device based on platform
        function getAudioInputParams() {
            const platform = process.platform;

            if (platform === 'win32') {
                // Windows - use exact device name for Rear Mic
                return {
                    format: 'dshow',
                    device: microphoneDevice || 'audio=Rear Mic (2- High Definition Audio Device)',
                };
            } else if (platform === 'darwin') {
                // macOS
                return {
                    format: 'avfoundation',
                    device: microphoneDevice || ':0', // Default input device
                };
            } else {
                // Linux and others
                return {
                    format: 'alsa',
                    device: microphoneDevice || 'default',
                };
            }
        }

        // Handle keyboard events for shortcuts
        process.stdin.on('data', async (key) => {
            // Control characters
            const CTRL_T = 20; // Ctrl+T
            const CTRL_C = 3; // Ctrl+C

            // Check for Ctrl+T (start/stop recording)
            if (key.length === 1 && key[0] === CTRL_T && voiceInputEnabled) {
                if (isRecording) {
                    logger.info('Stopping recording...');
                    await stopRecording();
                } else {
                    logger.info('Starting recording...');
                    startRecording();
                }
                return;
            }

            // Ctrl+C for exit
            if (key.length === 1 && key[0] === CTRL_C) {
                if (isRecording) {
                    await stopRecording();
                }
                logger.warn('Exiting Ace. Goodbye!');
                process.exit(0);
            }
        });

        // Function to start audio recording
        function startRecording() {
            if (!voiceInputEnabled) return;

            // Check if GROQ_API_KEY is set
            if (!process.env.GROQ_API_KEY) {
                logger.error(
                    'GROQ_API_KEY environment variable is not set. Voice input requires a Groq API key.'
                );
                logger.info('Please set the GROQ_API_KEY environment variable and restart Ace.');
                return;
            }

            // Clear current line and show recording indicator
            process.stdout.write('\r\x1b[K'); // Clear current line
            process.stdout.write(
                chalk.red('● ') + chalk.bold('Recording... (Press Ctrl+T to stop)') + '\n'
            );
            isRecording = true;

            // Get audio input parameters based on platform
            const { format, device } = getAudioInputParams();

            // Log the device being used
            logger.info(`Using audio device: ${device} with format: ${format}`);

            // Check if ffmpeg is installed
            try {
                // Use ffmpeg to record audio - adjusted command for optimal compatibility with Groq API
                recordingProcess = spawn('ffmpeg', [
                    '-f',
                    format,
                    '-i',
                    device,
                    '-ar',
                    '16000', // 16kHz sample rate - better for speech recognition
                    '-ac',
                    '1', // Mono
                    '-c:a',
                    'pcm_s16le', // 16-bit PCM
                    '-y', // Overwrite existing file
                    '-loglevel',
                    'error', // Only show errors
                    '-fflags',
                    '+shortest', // Complete recording promptly
                    '-frame_drop_threshold',
                    '5', // Reduce latency
                    recordingFile,
                ]);

                recordingProcess.stderr.on('data', (data: Buffer) => {
                    // Log all FFmpeg output for debugging
                    const stderr = data.toString();
                    logger.debug(`FFmpeg: ${stderr.trim()}`);

                    // Only log critical errors
                    if (
                        stderr.includes('Error') ||
                        stderr.includes('Invalid') ||
                        stderr.includes('No such')
                    ) {
                        logger.error(`FFmpeg error: ${stderr.trim()}`);
                        // If there's an error, stop recording
                        if (isRecording) {
                            stopRecording();
                            logger.error(
                                'Recording failed. Please check your microphone configuration.'
                            );
                        }
                    }
                });

                recordingProcess.on('error', (err: Error) => {
                    logger.error(`Recording error: ${err.message}`);
                    logger.error(
                        'Make sure ffmpeg is installed and your microphone is properly configured.'
                    );

                    // Display troubleshooting help
                    logger.info('Troubleshooting:');
                    logger.info('1. Install FFmpeg: https://ffmpeg.org/download.html');
                    logger.info('2. Make sure your microphone is connected and working');
                    logger.info('3. Set your microphone device with the "voice-device" command:');

                    if (process.platform === 'win32') {
                        logger.info(
                            '   - Run "ffmpeg -list_devices true -f dshow -i dummy" to list available devices'
                        );
                        logger.info('   - Then use: voice-device "audio=Your Microphone Name"');
                        logger.info('   - Or try: voice-detect to auto-detect microphones');
                    } else if (process.platform === 'darwin') {
                        logger.info(
                            '   - Run "ffmpeg -f avfoundation -list_devices true -i """ to list available devices'
                        );
                        logger.info(
                            '   - Then use: voice-device "0" (or the number of your input device)'
                        );
                    } else {
                        logger.info('   - Try: voice-device "hw:0,0" or another ALSA device name');
                    }

                    isRecording = false;
                });
            } catch (error) {
                logger.error('Failed to start recording. Make sure ffmpeg is installed.');
                isRecording = false;
            }

            // Start animation to indicate recording is in progress
            let dots = 0;
            const recordingAnimation = setInterval(() => {
                if (!isRecording) {
                    clearInterval(recordingAnimation);
                    return;
                }

                process.stdout.write(
                    `\r\x1b[K${chalk.red('● ')}${chalk.bold('Recording')}${'.'.repeat(dots % 4)}`
                );
                dots++;
            }, 500);
        }

        // Function to stop audio recording and process the audio
        async function stopRecording() {
            if (!isRecording) return;

            // Clear recording animation
            process.stdout.write('\r\x1b[K'); // Clear current line
            process.stdout.write(chalk.yellow('⏳ ') + chalk.bold('Processing speech...') + '\n');

            // Kill the ffmpeg process gracefully
            if (recordingProcess) {
                try {
                    // Send SIGTERM to ffmpeg
                    if (process.platform === 'win32') {
                        spawn('taskkill', ['/pid', recordingProcess.pid.toString(), '/f', '/t']);
                    } else {
                        recordingProcess.kill('SIGTERM');
                    }
                } catch (err) {
                    logger.error(`Error stopping recording: ${err}`);
                }
                recordingProcess = null;
            }

            isRecording = false;

            // Wait a moment for the file to be properly saved - increased timeout
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // For debugging - log file existence and size
            try {
                if (fs.existsSync(recordingFile)) {
                    const stats = fs.statSync(recordingFile);
                    logger.debug(`Recording file size: ${stats.size} bytes`);

                    // If debug mode is on, save a copy with timestamp
                    if (voiceDebugMode) {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const debugFile = path.join(
                            os.tmpdir(),
                            `ace_debug_recording_${timestamp}.wav`
                        );
                        fs.copyFileSync(recordingFile, debugFile);
                        logger.info(`Saved debug recording to: ${debugFile}`);
                    }
                } else {
                    logger.debug('Recording file does not exist');
                }
            } catch (err) {
                logger.debug(`Error checking recording file: ${err}`);
            }

            // Check if the recording file exists and has content
            if (fs.existsSync(recordingFile) && fs.statSync(recordingFile).size > 1000) {
                // Ensure it has some minimum content
                try {
                    // For testing - always keep a copy of the last recording
                    const lastRecordingFile = path.join(os.tmpdir(), 'ace_last_recording.wav');
                    fs.copyFileSync(recordingFile, lastRecordingFile);
                    logger.debug(`Saved copy of recording to: ${lastRecordingFile}`);

                    // Transcribe the recording with more detailed logging
                    logger.info('Sending audio to Groq API for transcription...');
                    const result = await transcribeWithGroq({
                        model: 'whisper-large-v3-turbo',
                        file: recordingFile,
                        response_format: 'json',
                    });

                    if (voiceDebugMode) {
                        logger.info(`Transcription result: ${JSON.stringify(result, null, 2)}`);
                    } else {
                        logger.debug(`Transcription result: ${JSON.stringify(result)}`);
                    }

                    if (result.text.trim()) {
                        // Display the transcribed text with a speech bubble icon
                        logger.info(
                            `${chalk.green('🗣️ ')}You said: "${result.text}"`,
                            null,
                            'green'
                        );

                        // Process the transcribed text as a command
                        if (handleCliCommand(result.text)) {
                            // If it was a CLI command, don't send it to the agent
                        } else {
                            // Send to agent
                            if (streamingEnabled) {
                                await agent.runStreaming(result.text);
                            } else {
                                await agent.run(result.text);
                            }
                        }
                    } else {
                        logger.warn('No speech detected. Please try again and speak clearly.');
                    }
                } catch (error) {
                    logger.error(
                        `Speech processing error: ${error instanceof Error ? error.message : String(error)}`
                    );

                    // If API key is invalid, provide helpful message
                    if (error instanceof Error && error.message.includes('API key')) {
                        logger.error('Please check your GROQ_API_KEY environment variable.');
                        logger.info(
                            'You can get a Groq API key from: https://console.groq.com/keys'
                        );
                    }
                }
            } else {
                logger.warn('Recording was too short or failed. Please try again.');
                logger.info('Make sure your microphone is unmuted and working properly.');

                // Additional debugging for empty recordings
                if (fs.existsSync(recordingFile)) {
                    const stats = fs.statSync(recordingFile);
                    logger.error(
                        `Recording file exists but is empty or too small (${stats.size} bytes).`
                    );
                    logger.info('Try speaking louder or positioning your microphone closer.');
                } else {
                    logger.error('Recording file was not created.');
                    logger.info('Check FFmpeg installation and microphone permissions.');
                }
            }

            // Clean up the recording file (except in debug mode)
            try {
                if (fs.existsSync(recordingFile) && !voiceDebugMode) {
                    fs.unlinkSync(recordingFile);
                }
            } catch (err) {
                // Ignore errors when cleaning up
                logger.debug(`Error cleaning up recording file: ${err}`);
            }

            // Prompt for next input
            rl.prompt();
        }

        // Make sure stdin is in flowing mode
        process.stdin.resume();
        rl.prompt();

        // Main interaction loop - simplified with question-based approach
        const promptUser = () => {
            return new Promise<string>((resolve) => {
                // Check if stdin is still connected/readable
                if (!process.stdin.isTTY) {
                    logger.warn('Input stream closed. Exiting CLI.');
                    resolve('exit'); // Simulate exit command
                    return;
                }
                process.stdin.resume();
                rl.question(chalk.bold.green('\nWhat would you like to do? '), (answer) => {
                    resolve(answer.trim());
                });
            });
        };

        function handleCliCommand(input: string): boolean {
            const lowerInput = input.toLowerCase().trim();
            const parts = input.split(' ');
            const command = parts[0].toLowerCase();

            if (lowerInput === 'exit' || lowerInput === 'quit') {
                logger.warn('Exiting AI CLI. Goodbye!');
                rl.close();
                process.exit(0);
            }

            if (lowerInput === 'clear') {
                agent.resetConversation();
                logger.info('Conversation history cleared.');
                return true;
            }

            if (validLogLevels.includes(lowerInput)) {
                logger.setLevel(lowerInput);
                return true;
            }

            if (lowerInput === 'currentloglevel') {
                logger.info(`Current log level: ${logger.getLevel()}`);
                return true;
            }

            if (lowerInput === 'help') {
                showHelp();
                return true;
            }

            // New commands for streaming control
            if (lowerInput === 'streaming on') {
                streamingEnabled = true;
                logger.info('Streaming mode enabled.');
                return true;
            }

            if (lowerInput === 'streaming off') {
                streamingEnabled = false;
                logger.info('Streaming mode disabled.');
                return true;
            }

            // Voice input mode toggle
            if (lowerInput === 'voice') {
                voiceInputEnabled = !voiceInputEnabled;
                if (voiceInputEnabled) {
                    logger.info('Voice input mode enabled. Press Ctrl+T to start/stop recording.');
                    // Show the current microphone device
                    const { device, format } = getAudioInputParams();
                    logger.info(`Using microphone: ${device} (${format})`);
                    // Show debug status
                    if (voiceDebugMode) {
                        logger.info(
                            'Voice debug mode is ON. Recordings will be saved in temp directory.'
                        );
                    }
                } else {
                    logger.info('Voice input mode disabled.');
                    if (isRecording) {
                        stopRecording();
                    }
                }
                return true;
            }

            // Toggle voice debug mode
            if (lowerInput === 'voice-debug') {
                voiceDebugMode = !voiceDebugMode;
                if (voiceDebugMode) {
                    logger.info('Voice debug mode enabled. Recordings will be saved to:');
                    logger.info(path.join(os.tmpdir(), 'ace_debug_recording_*.wav'));
                } else {
                    logger.info('Voice debug mode disabled.');
                }
                return true;
            }

            // Set voice input device
            if (command === 'voice-device') {
                const deviceName = parts.slice(1).join(' ');
                if (deviceName) {
                    microphoneDevice = deviceName;
                    logger.info(`Microphone device set to: "${deviceName}"`);

                    // If we're on Windows, give a hint about quotes
                    if (
                        process.platform === 'win32' &&
                        !deviceName.startsWith('"') &&
                        !deviceName.includes('=')
                    ) {
                        logger.info(
                            'Note: For Windows, you may need to include "audio=" prefix and quotes:'
                        );
                        logger.info(`voice-device "audio=${deviceName}"`);
                    }
                } else {
                    logger.error('Missing device name. Usage: voice-device "Device Name"');

                    // Show platform-specific help
                    if (process.platform === 'win32') {
                        logger.info(
                            'For Windows, list devices with: ffmpeg -list_devices true -f dshow -i dummy'
                        );
                        logger.info('Example: voice-device "audio=Microphone Array"');
                    } else if (process.platform === 'darwin') {
                        logger.info(
                            'For macOS, list devices with: ffmpeg -f avfoundation -list_devices true -i ""'
                        );
                        logger.info(
                            'Example: voice-device "0" (use the number of your input device)'
                        );
                    } else {
                        logger.info(
                            'For Linux, try: voice-device "default" or voice-device "hw:0,0"'
                        );
                    }
                }
                return true;
            }

            // Handle transcribe command
            if (command === 'transcribe') {
                handleTranscribeCommand(parts.slice(1));
                return true;
            }

            // Handle audio preprocessing command
            if (command === 'preprocess-audio') {
                handlePreprocessCommand(parts.slice(1));
                return true;
            }

            // Test voice input configuration
            if (lowerInput === 'voice-test') {
                testMicrophoneSetup();
                return true;
            }

            // Auto-detect microphones (Windows only)
            if (lowerInput === 'voice-detect') {
                detectMicrophones();
                return true;
            }

            return false;
        }

        /**
         * Handle the transcribe command with arguments
         */
        async function handleTranscribeCommand(args: string[]) {
            if (args.length === 0) {
                logger.error('Missing audio file path. Usage: transcribe <file> [options]');
                logger.info(`
Transcribe options:
  --model <model>     Model to use (whisper-large-v3-turbo, distil-whisper-large-v3-en, whisper-large-v3)
  --language <code>   Language code (e.g., en, fr, es)
  --prompt <text>     Prompt to guide transcription style
  --verbose           Return detailed output with timestamps
  --translate         Translate audio to English (uses whisper-large-v3)
  --output <file>     Save output to file instead of console
                `);
                return;
            }

            const filePath = args[0];
            const options: TranscribeOptions = {};

            // Parse options
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg === '--verbose') {
                    options.verbose = true;
                } else if (arg === '--translate') {
                    options.translate = true;
                } else if (arg === '--model' && i + 1 < args.length) {
                    const modelValue = args[++i] as GroqSpeechModel;
                    // Validate model
                    if (
                        modelValue === 'whisper-large-v3-turbo' ||
                        modelValue === 'distil-whisper-large-v3-en' ||
                        modelValue === 'whisper-large-v3'
                    ) {
                        options.model = modelValue;
                    } else {
                        logger.warn(`Invalid model: ${modelValue}. Using default.`);
                    }
                } else if (arg === '--language' && i + 1 < args.length) {
                    options.language = args[++i];
                } else if (arg === '--prompt' && i + 1 < args.length) {
                    options.prompt = args[++i];
                } else if (arg === '--output' && i + 1 < args.length) {
                    options.output = args[++i];
                }
            }

            try {
                await transcribeCommand(filePath, options);
            } catch (error) {
                logger.error(
                    `Transcription failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        /**
         * Handle the audio preprocessing command with arguments
         */
        async function handlePreprocessCommand(args: string[]) {
            if (args.length === 0) {
                logger.error('Missing audio file path. Usage: preprocess-audio <file> [options]');
                logger.info(`
Preprocess options:
  --format <format>     Output format: wav, flac, or mp3 (default: flac)
  --sample-rate <rate>  Sample rate in Hz (default: 16000)
  --stereo              Keep stereo audio (default: convert to mono)
  --output <file>       Custom output file path
                `);
                return;
            }

            const inputFile = args[0];
            const options: {
                format?: 'wav' | 'flac' | 'mp3';
                sampleRate?: number;
                stereo?: boolean;
                output?: string;
            } = {};

            // Parse options
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                if (arg === '--stereo') {
                    options.stereo = true;
                } else if (arg === '--format' && i + 1 < args.length) {
                    const format = args[++i];
                    if (['wav', 'flac', 'mp3'].includes(format)) {
                        options.format = format as 'wav' | 'flac' | 'mp3';
                    } else {
                        logger.warn(`Invalid format: ${format}. Using default.`);
                    }
                } else if (arg === '--sample-rate' && i + 1 < args.length) {
                    const rate = parseInt(args[++i], 10);
                    if (!isNaN(rate) && rate > 0) {
                        options.sampleRate = rate;
                    } else {
                        logger.warn(`Invalid sample rate: ${args[i]}. Using default.`);
                    }
                } else if (arg === '--output' && i + 1 < args.length) {
                    options.output = args[++i];
                }
            }

            try {
                const outputFile = await preprocessCommand(inputFile, options);
                logger.info(`Preprocessed audio saved to: ${outputFile}`);
            } catch (error) {
                logger.error(
                    `Audio preprocessing failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        function showHelp() {
            logger.info(HELP_MESSAGE + 'streaming on/off - Enable/disable streaming mode');
        }

        // Enable streaming by default
        let streamingEnabled = true;

        // Function to test microphone setup
        async function testMicrophoneSetup() {
            logger.info('Testing microphone setup...');

            // Get audio input parameters based on platform
            const { format, device } = getAudioInputParams();

            logger.info(`Using audio device: ${device} with format: ${format}`);

            // Create a unique test file
            const testFile = path.join(os.tmpdir(), `ace_mic_test_${Date.now()}.wav`);

            // Flag to track test status
            let testFailed = false;
            let testProcess: any = null;

            try {
                // Run ffmpeg to record a short 5-second clip
                logger.info('Recording a 5-second test clip...');
                logger.info('Please speak into your microphone now.');

                return new Promise<void>((resolve) => {
                    testProcess = spawn('ffmpeg', [
                        '-f',
                        format,
                        '-i',
                        device,
                        '-ar',
                        '16000', // 16kHz sample rate - better for speech recognition
                        '-ac',
                        '1', // Mono
                        '-c:a',
                        'pcm_s16le', // 16-bit PCM
                        '-t',
                        '5', // Record for 5 seconds
                        '-y', // Overwrite existing file
                        '-loglevel',
                        'info', // Use info level to see more output
                        '-fflags',
                        '+shortest', // Complete recording promptly
                        testFile,
                    ]);

                    let ffmpegOutput = '';

                    testProcess.stderr.on('data', (data: Buffer) => {
                        const stderr = data.toString();
                        ffmpegOutput += stderr;

                        // Print FFmpeg output for debugging
                        if (stderr.trim()) {
                            logger.debug(`FFmpeg: ${stderr.trim()}`);
                        }

                        // Check for common errors
                        if (
                            stderr.includes('Error') ||
                            stderr.includes('Invalid') ||
                            stderr.includes('No such')
                        ) {
                            testFailed = true;
                        }
                    });

                    // Display a countdown for the test recording
                    let countdown = 5;
                    const countdownInterval = setInterval(() => {
                        if (countdown <= 0) {
                            clearInterval(countdownInterval);
                            return;
                        }
                        process.stdout.write(
                            `\r\x1b[KRecording test: ${countdown} seconds remaining...`
                        );
                        countdown--;
                    }, 1000);

                    testProcess.on('close', async (code) => {
                        clearInterval(countdownInterval);
                        process.stdout.write('\r\x1b[K'); // Clear the countdown line

                        if (code !== 0) {
                            logger.error(`FFmpeg exited with code ${code}`);
                            testFailed = true;
                        }

                        // Check if the recording file exists and has content
                        if (fs.existsSync(testFile)) {
                            const stats = fs.statSync(testFile);

                            if (stats.size > 1000) {
                                // Reasonable size for a 5-second clip
                                logger.info(
                                    `✅ Microphone test successful! Recorded ${stats.size} bytes.`
                                );

                                // Try to transcribe the recording
                                try {
                                    logger.info('Attempting to transcribe the test recording...');
                                    const result = await transcribeWithGroq({
                                        model: 'whisper-large-v3-turbo',
                                        file: testFile,
                                        response_format: 'json',
                                    });

                                    if (result.text.trim()) {
                                        logger.info(`✅ Transcription successful!`);
                                        logger.info(`🗣️ Transcribed text: "${result.text}"`);

                                        // Hint for next steps
                                        logger.info('\nTo use voice input:');
                                        logger.info(
                                            '1. Run the "voice" command to enable voice input mode'
                                        );
                                        logger.info('2. Press Ctrl+T to start/stop recording');
                                    } else {
                                        logger.warn(
                                            `⚠️ Transcription returned empty text. Try speaking louder.`
                                        );
                                    }
                                } catch (err) {
                                    logger.error(
                                        `❌ Transcription failed: ${err instanceof Error ? err.message : String(err)}`
                                    );
                                    logger.info('Check your GROQ_API_KEY environment variable.');
                                }
                            } else {
                                logger.error(
                                    `❌ Recording file is too small (${stats.size} bytes).`
                                );
                                logger.info(
                                    'The microphone might not be capturing audio properly.'
                                );
                                testFailed = true;
                            }

                            // Save the test file for further investigation
                            const savedTestFile = path.join(os.tmpdir(), 'ace_last_mic_test.wav');
                            fs.copyFileSync(testFile, savedTestFile);
                            logger.info(`Test recording saved to: ${savedTestFile}`);

                            // Clean up the test file
                            try {
                                fs.unlinkSync(testFile);
                            } catch (err) {
                                logger.debug(`Error cleaning up test file: ${err}`);
                            }
                        } else {
                            logger.error('❌ No recording file was created.');
                            testFailed = true;
                        }

                        // Show troubleshooting if test failed
                        if (testFailed) {
                            showMicrophoneTroubleshooting(ffmpegOutput);
                        }

                        // Make sure to restore the prompt
                        rl.prompt();
                        resolve();
                    });

                    testProcess.on('error', (err: Error) => {
                        clearInterval(countdownInterval);
                        logger.error(`❌ Failed to start FFmpeg: ${err.message}`);
                        logger.error('Make sure FFmpeg is installed on your system.');
                        testFailed = true;
                        rl.prompt();
                        resolve();
                    });
                });
            } catch (err) {
                logger.error(
                    `❌ Error during microphone test: ${err instanceof Error ? err.message : String(err)}`
                );
                testFailed = true;
                rl.prompt();
            }
        }

        // Show troubleshooting tips for microphone setup
        function showMicrophoneTroubleshooting(ffmpegOutput: string) {
            logger.info('\n📋 Microphone Troubleshooting Guide:');

            // Windows-specific troubleshooting
            if (process.platform === 'win32') {
                logger.info('1️⃣ List available audio devices:');
                logger.info('   Run this command in a separate terminal:');
                logger.info('   ffmpeg -list_devices true -f dshow -i dummy');

                logger.info('\n2️⃣ Check device name format:');
                logger.info('   • Make sure to use the exact device name from the list');
                logger.info('   • Include the "audio=" prefix');
                logger.info('   • Use quotes around the device name');
                logger.info(
                    '   Example: voice-device "audio=Microphone (Realtek High Definition Audio)"'
                );

                logger.info('\n3️⃣ Check Windows privacy settings:');
                logger.info('   • Open Windows Settings > Privacy > Microphone');
                logger.info('   • Ensure microphone access is enabled for apps');

                // Check for specific errors in FFmpeg output
                if (ffmpegOutput.includes('Could not enumerate video devices')) {
                    logger.info('\n⚠️ DirectShow device enumeration error detected.');
                    logger.info('   This usually means FFmpeg cannot access your audio devices.');
                    logger.info('   Try running Ace with administrator privileges.');
                }

                if (ffmpegOutput.includes('Device not found')) {
                    logger.info('\n⚠️ Device not found error detected.');
                    logger.info('   The specified microphone device could not be found.');
                    logger.info('   Use the exact name from the ffmpeg -list_devices command.');
                }
            } else if (process.platform === 'darwin') {
                // macOS troubleshooting
                logger.info('1️⃣ List available audio devices:');
                logger.info('   Run this command in a separate terminal:');
                logger.info('   ffmpeg -f avfoundation -list_devices true -i ""');

                logger.info('\n2️⃣ Check device format:');
                logger.info('   • For macOS, use the device number from the list');
                logger.info('   Example: voice-device "0"');

                logger.info('\n3️⃣ Check macOS privacy settings:');
                logger.info(
                    '   • Open System Preferences > Security & Privacy > Privacy > Microphone'
                );
                logger.info('   • Ensure Terminal or your application has microphone access');
            } else {
                // Linux troubleshooting
                logger.info('1️⃣ List available audio devices:');
                logger.info('   Run these commands in a separate terminal:');
                logger.info('   arecord -l');
                logger.info('   Or try: ffmpeg -f alsa -list_devices true -i dummy');

                logger.info('\n2️⃣ Check device format:');
                logger.info('   • For Linux, try "default" or a specific device like "hw:0,0"');
                logger.info('   Example: voice-device "default"');
            }

            logger.info('\n4️⃣ General troubleshooting:');
            logger.info('   • Make sure your microphone is not muted in system settings');
            logger.info('   • Try using a different microphone if available');
            logger.info('   • Run "voice-debug" command to enable debug mode and save recordings');
        }

        // Auto-detect available microphones
        async function detectMicrophones() {
            if (process.platform !== 'win32') {
                logger.info('Microphone auto-detection is currently only supported on Windows.');
                logger.info('For other platforms, please use the appropriate commands:');
                if (process.platform === 'darwin') {
                    logger.info('macOS: ffmpeg -f avfoundation -list_devices true -i ""');
                } else {
                    logger.info('Linux: arecord -l or ffmpeg -f alsa -list_devices true -i dummy');
                }
                return;
            }

            logger.info('Detecting available microphones...');

            try {
                // Run ffmpeg to list devices
                const ffmpeg = spawn('ffmpeg', [
                    '-list_devices',
                    'true',
                    '-f',
                    'dshow',
                    '-i',
                    'dummy',
                ]);

                let output = '';
                let micDevices: string[] = [];

                ffmpeg.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString();
                    output += chunk;

                    // Parse the output to find audio input devices
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        // Look for lines that contain audio input devices
                        if (
                            line.includes('DirectShow audio devices') ||
                            line.includes('Alternative name')
                        ) {
                            continue; // Skip header lines
                        }

                        // Check for audio device pattern - typically shows as "DeviceName"
                        const audioDeviceMatch = line.match(/\[dshow @ [^\]]+\] +\"([^\"]+)\"/);
                        if (audioDeviceMatch && line.includes('(audio)')) {
                            const deviceName = audioDeviceMatch[1];
                            // Add with the proper prefix format
                            micDevices.push(`audio=${deviceName}`);
                        }
                    }
                });

                // Wait for process to finish
                return new Promise<void>((resolve) => {
                    ffmpeg.on('close', (code) => {
                        if (code !== 0 && code !== 1) {
                            // FFmpeg exits with code 1 when listing devices
                            logger.error(`FFmpeg exited with code ${code}`);
                            logger.error(
                                'Failed to detect microphones. Make sure FFmpeg is installed.'
                            );
                            resolve();
                            return;
                        }

                        if (micDevices.length === 0) {
                            // Try another approach by parsing the full output
                            const audioDeviceRegex = /\[dshow @ [^\]]+\] +\"([^\"]+)\" \(audio\)/g;
                            let match;
                            while ((match = audioDeviceRegex.exec(output)) !== null) {
                                micDevices.push(`audio=${match[1]}`);
                            }
                        }

                        if (micDevices.length === 0) {
                            logger.error('No audio input devices detected.');
                            logger.info(
                                'Check if your microphone is connected and recognized by Windows.'
                            );
                            resolve();
                            return;
                        }

                        // Display the detected microphones
                        logger.info(`Found ${micDevices.length} audio input devices:`);
                        micDevices.forEach((device, index) => {
                            logger.info(`${index + 1}. "${device}"`);
                        });

                        // Prompt user to select a device
                        logger.info('\nTo select a microphone, use the command:');
                        logger.info(`voice-device "DEVICE_NAME"`);
                        logger.info('For example:');
                        if (micDevices.length > 0) {
                            logger.info(`voice-device "${micDevices[0]}"`);
                        }

                        // Ask if user wants to set the first device automatically
                        if (micDevices.length > 0) {
                            const saveRawMode = process.stdin.isRaw;
                            if (saveRawMode) {
                                process.stdin.setRawMode(false);
                            }

                            // Create a temporary readline interface for this question
                            const tempRl = readline.createInterface({
                                input: process.stdin,
                                output: process.stdout,
                            });

                            tempRl.question(
                                `\nWould you like to use "${micDevices[0]}" as your microphone? (y/n) `,
                                (answer) => {
                                    tempRl.close();

                                    if (
                                        answer.toLowerCase() === 'y' ||
                                        answer.toLowerCase() === 'yes'
                                    ) {
                                        // Set the microphone device
                                        microphoneDevice = micDevices[0];
                                        logger.info(`Microphone set to: "${microphoneDevice}"`);

                                        // Suggest testing the microphone
                                        logger.info(
                                            '\nRun "voice-test" to verify the microphone works correctly.'
                                        );
                                    } else {
                                        logger.info(
                                            'No microphone selected. Use "voice-device" command to set manually.'
                                        );
                                    }

                                    // Restore raw mode if it was on
                                    if (saveRawMode) {
                                        process.stdin.setRawMode(true);
                                    }

                                    resolve();
                                }
                            );
                        } else {
                            resolve();
                        }
                    });

                    ffmpeg.on('error', (err: Error) => {
                        logger.error(`Failed to run FFmpeg: ${err.message}`);
                        logger.error('Make sure FFmpeg is installed on your system.');
                        resolve();
                    });
                });
            } catch (err) {
                logger.error(
                    `Error detecting microphones: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        try {
            while (true) {
                const userInput = await promptUser();

                if (handleCliCommand(userInput)) {
                    continue;
                }

                try {
                    // Use streaming mode by default
                    if (streamingEnabled) {
                        await agent.runStreaming(userInput);
                    } else {
                        // Use non-streaming mode if disabled
                        await agent.run(userInput);
                    }
                } catch (error) {
                    logger.error(
                        `Error in processing input: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        } finally {
            // Ensure cleanup happens even if the loop breaks unexpectedly
            if (isRecording && recordingProcess) {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', recordingProcess.pid.toString(), '/f', '/t']);
                } else {
                    recordingProcess.kill('SIGTERM');
                }
            }
            rl.close();
        }
    } catch (error) {
        logger.error(`Error during CLI initialization: ${error.message}`);
        process.exit(1); // Exit with error code if CLI setup fails
    }
}

/**
 * Run a single headless command via CLI without interactive prompt
 * @param agent The AceAgent instance providing access to all required services
 * @param prompt The user input to process
 */
export async function startHeadlessCli(agent: AceAgent, prompt: string): Promise<void> {
    // Common initialization
    await _initCli(agent);
    try {
        // Execute the task
        await agent.run(prompt);
    } catch (error) {
        logger.error(
            `Error in processing input: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1); // Exit with error code if headless execution fails
    }
}
