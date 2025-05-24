# Speech-to-Text with Groq API

Ace now supports speech-to-text functionality using Groq's API, allowing you to transcribe and translate audio files with high accuracy and speed.

## Setup

1. Get a Groq API key from [Groq's website](https://console.groq.com/keys).
2. Add your API key to your environment variables:
   ```
   GROQ_API_KEY=your_api_key_here
   ```

3. Make sure you have FFmpeg installed for audio recording and preprocessing:
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to your PATH
   - **Ubuntu/Debian**: `sudo apt install ffmpeg`
   - **macOS**: `brew install ffmpeg`

## Voice Input Mode in CLI

Ace supports voice input directly in the CLI, allowing you to speak to Ace instead of typing:

```bash
ace
```

Once in the CLI:

1. Type `voice` and press Enter to enable voice input mode
2. Press `Ctrl+T` to start recording your voice
3. Speak your command or question
4. Press `Ctrl+T` again to stop recording and process your speech
5. Ace will transcribe your speech and process it as if you had typed it

This works for both regular commands and CLI-specific commands like `clear` or `help`.

To disable voice input mode, type `voice` again and press Enter.

### Voice Input Commands

Ace provides several commands to help set up and troubleshoot voice input:

- `voice` - Toggle voice input mode on/off
- `voice-device "device-name"` - Set a specific microphone device
- `voice-debug` - Toggle debug mode (saves recordings for troubleshooting)
- `voice-test` - Record a 5-second test clip to verify microphone setup
- `voice-detect` - Auto-detect available microphones (Windows only)

### Auto-Detecting Microphones (Windows)

On Windows, you can use the `voice-detect` command to automatically find available microphones:

```bash
voice-detect
```

This will:
1. List all available audio input devices
2. Show the exact device names you can use
3. Ask if you want to use the first detected microphone
4. If you answer yes, it will set that device automatically

### Testing Your Microphone

To verify your microphone is working correctly with Ace:

```bash
voice-test
```

This command:
1. Records a 5-second audio clip using your current microphone
2. Attempts to transcribe it with Groq's API
3. Shows the transcription result if successful
4. Provides troubleshooting tips if there are issues
5. Saves the test recording for further investigation if needed

### Debug Mode

If you're having issues with voice input, enable debug mode:

```bash
voice-debug
```

When debug mode is enabled:
- All voice recordings are saved in your temp directory
- Detailed transcription results are shown
- The temporary WAV files aren't deleted automatically

This is useful for troubleshooting issues with microphone configuration or audio quality.

### Custom Microphone Configuration

If your default microphone isn't being detected correctly, you can specify a custom input device:

```bash
voice-device "your-device-name"
```

#### Platform-Specific Device Configuration

**Windows:**
1. List available devices:
   ```
   ffmpeg -list_devices true -f dshow -i dummy
   ```
   Or use the built-in command:
   ```
   voice-detect
   ```
2. Set your microphone using the device name:
   ```
   voice-device "audio=Microphone Array"
   ```

**macOS:**
1. List available devices:
   ```
   ffmpeg -f avfoundation -list_devices true -i ""
   ```
2. Set your microphone using the device index:
   ```
   voice-device "0"
   ```
   (where "0" is the index of your input device)

**Linux:**
1. Use the default ALSA device:
   ```
   voice-device "default"
   ```
2. Or specify a hardware device:
   ```
   voice-device "hw:0,0"
   ```

### Troubleshooting Voice Input

If you're having issues with voice input:

1. **Check that FFmpeg is installed**:
   - Run `ffmpeg -version` to verify
   - Install if needed (see Setup section)

2. **Verify your microphone works**:
   - Use `voice-test` to check if your microphone is working
   - Try recording with other applications to confirm it works

3. **Try auto-detection on Windows**:
   - Run `voice-detect` to find available microphones

4. **Enable debug mode**:
   - Run `voice-debug` to save recordings for analysis
   - Check the temp directory for saved audio files

5. **Check environment variables**:
   - Ensure `GROQ_API_KEY` is set correctly
   - Run `echo $GROQ_API_KEY` (Linux/macOS) or `echo %GROQ_API_KEY%` (Windows)

6. **Common issues**:
   - Windows: Ensure quotes and "audio=" prefix are used correctly
   - macOS: Check microphone permissions for Terminal/app
   - All platforms: Ensure microphone isn't muted in system settings

### Requirements for Voice Input Mode

- FFmpeg must be installed (see Setup section)
- A working microphone
- The `GROQ_API_KEY` environment variable must be set

## Using the CLI Transcribe Command

For transcribing audio files (rather than live speech), use the `transcribe` command:

```bash
ace transcribe <audio-file> [options]
```

### Options

- `--model <model>`: Specify the model to use (default: `whisper-large-v3-turbo`)
  - Available models:
    - `whisper-large-v3-turbo`: Fast multilingual transcription
    - `distil-whisper-large-v3-en`: Optimized for English-only transcription
    - `whisper-large-v3`: Highest accuracy for multilingual transcription and translation
- `--language <code>`: Specify the language code (e.g., `en`, `fr`, `es`)
- `--prompt <text>`: Provide a prompt to guide the transcription style or specify how to spell unfamiliar words
- `--verbose`: Return detailed output with timestamps (uses `verbose_json` format)
- `--translate`: Translate audio to English (uses `whisper-large-v3`)
- `--output <file>`: Save output to a file instead of printing to console

### Examples

Basic transcription:
```bash
ace transcribe recording.mp3
```

Transcribe with a specific model and language:
```bash
ace transcribe recording.mp3 --model whisper-large-v3 --language fr
```

Translate audio to English:
```bash
ace transcribe foreign_speech.mp3 --translate
```

Get detailed output with timestamps:
```bash
ace transcribe interview.mp3 --verbose
```

Save transcription to a file:
```bash
ace transcribe lecture.mp3 --output lecture_transcript.txt
```

## Audio Preprocessing

Ace includes a built-in audio preprocessing command that optimizes audio files for speech-to-text processing. This uses FFmpeg under the hood, so make sure you have FFmpeg installed on your system.

```bash
ace preprocess-audio <audio-file> [options]
```

### Preprocessing Options

- `--format <format>`: Output format (`wav`, `flac`, or `mp3`, default: `flac`)
- `--sample-rate <rate>`: Sample rate in Hz (default: `16000`)
- `--stereo`: Keep stereo audio (default: convert to mono)
- `--output <file>`: Custom output file path

### Preprocessing Examples

Convert to optimal format for transcription:
```bash
ace preprocess-audio recording.mp3
```

Specify output format and sample rate:
```bash
ace preprocess-audio recording.mp3 --format wav --sample-rate 16000
```

Keep stereo audio:
```bash
ace preprocess-audio recording.mp3 --stereo
```

Specify output file path:
```bash
ace preprocess-audio recording.mp3 --output optimized_recording.flac
```

### End-to-end Example

Preprocess and then transcribe:
```bash
# First preprocess the audio
ace preprocess-audio recording.mp3 --format flac

# Then transcribe the preprocessed file
ace transcribe recording_processed.flac --language en
```

## Supported Audio Formats

- FLAC
- MP3
- MP4
- MPEG
- MPGA
- M4A
- OGG
- WAV
- WEBM

## File Size Limitations

- Maximum file size: 25 MB (free tier), 100MB (dev tier)
- For larger files, consider chunking the audio into smaller segments

## Audio Preprocessing Tips

For optimal results, consider preprocessing your audio files:
- Convert to 16kHz mono audio
- Use WAV format for lowest latency
- Use FLAC for lossless compression with smaller file size

Example using FFmpeg directly:
```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -map 0:a -c:a flac output.flac
```

## Programmatic Usage

You can also use the speech-to-text functionality programmatically in your code:

```typescript
import { transcribeWithGroq, translateWithGroq } from '@core/ai/llm/services/groq-speech.js';

// Transcribe an audio file
const transcription = await transcribeWithGroq({
  model: 'whisper-large-v3-turbo',
  file: 'path/to/audio.mp3',
  language: 'en',
  response_format: 'json'
});

console.log(transcription.text);

// Translate an audio file to English
const translation = await translateWithGroq({
  model: 'whisper-large-v3',
  file: 'path/to/foreign_audio.mp3',
  response_format: 'json'
});

console.log(translation.text);
``` 