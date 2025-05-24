# Ace

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-yellow" alt="Status: Beta">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
</p>

**Use natural language to control your tools, apps, and services — connect once, command everything.**

Ace was built as a submission to the **Cerebras and OpenRouter hackathon** to explore Qwen's various tool-calling and LLM abilities, featuring streaming support and voice transcription via Groq.

<div align="center">
  <img src="https://github.com/user-attachments/assets/9a796427-ab97-4c8f-8ac2-09cf58135553" alt="Ace Demo" width="900" />
</div>

## Installation

**Global (npm)**
```bash
npm install -g @safzanpirani/ace
```

<details><summary><strong>Build & Link from source</strong></summary>

```bash
git clone https://github.com/safzanpirani/ace.git
cd ace
npm install
npm run build
npm link
```

After linking, the `ace` command becomes available globally.

</details>

## Quick Start

### CLI Mode

Invoke the interactive CLI:
```bash
ace
```

You can interact with Ace through:
- Text input (typing)
- Voice input (speaking) - Type `voice` and press Ctrl+T to start/stop recording
- Streaming responses for real-time AI interactions

See [Speech-to-Text Documentation](docs/speech-to-text.md) for details on voice input.

<details><summary><strong>Alternative: without global install</strong></summary>

You can also run directly via npm:
```bash
npm start
```

</details>

### Web UI Mode

Serve the experimental web interface with streaming support:
```bash
ace --mode web
```

<details><summary><strong>Alternative: without global install</strong></summary>

```bash
npm start -- --mode web
```

</details>

Open http://localhost:3000 in your browser.

### Bot Modes

Run Ace as a Discord or Telegram bot.

**Discord Bot:**
```bash
ace --mode discord
```
Make sure you have `DISCORD_BOT_TOKEN` set in your environment.

**Telegram Bot:**
```bash
ace --mode telegram
```
Make sure you have `TELEGRAM_BOT_TOKEN` set in your environment.

## Overview

Ace is an open, modular and extensible AI agent that lets you perform tasks across your tools, apps, and services using natural language. You describe what you want to do — Ace figures out which tools to invoke and orchestrates them seamlessly, whether that means running a shell command, summarizing a webpage, or calling an API.

Why developers choose Ace:

1. **Open & Extensible**: Connect to any service via the Model Context Protocol (MCP).
2. **Config-Driven Agents**: Define & save your agent prompts, tools (via MCP), and model in YAML.
3. **Multi-Interface Support**: Use via CLI, wrap it in a web UI, or integrate into other systems.
4. **Runs Anywhere**: Local-first runtime with logging, retries, and support for any LLM provider.
5. **Streaming Support**: Real-time AI responses with built-in streaming capabilities.
6. **Voice Transcription**: Powered by Groq for fast, accurate speech-to-text processing.
7. **OpenRouter Integration**: Access to Qwen models and hundreds of others through OpenRouter.
8. **Interoperable**: Expose as an API or connect to other agents via MCP/A2A(soon).

Ace is the missing natural language layer across your stack. Whether you're automating workflows, building agents, or prototyping new ideas, Ace gives you the tools to move fast — and bend it to your needs. Interact with Ace via the command line or the new experimental web UI with streaming support.

## CLI Reference

The `ace` command supports several options to customize its behavior. Run `ace --help` for the full list.

```
> ace -h
17:51:31 INFO: Log level set to: INFO
Usage: ace [options] [prompt...]

AI-powered CLI and WebUI for interacting with MCP servers

Arguments:
  prompt                    Optional headless prompt for single command mode

Options:
  -c, --config-file <path>  Path to config file (default: "configuration/ace.yml")
  -s, --strict              Require all server connections to succeed
  --no-verbose              Disable verbose output
  --mode <mode>             Run mode: cli, web, discord, or telegram (default: "cli")
  --web-port <port>         Port for WebUI (default: "3000")
  -m, --model <model>       Specify the LLM model to use
  -r, --router <router>     Specify the LLM router to use (vercel or in-built)
  --stream                  Enable streaming responses
  --voice                   Enable voice input with Groq transcription
  -V, --version             output the version number
```

**Common Examples:**

*   **Specify a custom configuration file:**
    ```bash
    cp configuration/ace.yml configuration/custom_config.yml
    ace --config-file configuration/custom_config.yml
    ```

*   **Use Qwen model via OpenRouter:**
    ```bash
    ace -m qwen/qwen3-32b:nitro
    ```

*   **Enable streaming with voice input:**
    ```bash
    ace --stream --voice
    ```

## Configuration

Ace defines agents using a YAML config file (`configuration/ace.yml` by default). To configure an agent, use tool servers (MCP servers) and LLM providers.

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
  puppeteer:
    type: stdio
    command: npx
    args:
      - -y
      - "@truffle-ai/puppeteer-server"

llm:
  provider: openrouter
  model: qwen/qwen3-32b:nitro
  apiKey: $OPENROUTER_API_KEY
  streaming: true

voice:
  provider: groq
  apiKey: $GROQ_API_KEY
  model: whisper-large-v3
```

## Discovering & Connecting MCP Servers

Ace communicates with your tools via Model Context Protocol (MCP) servers. You can discover and connect to MCP servers in several ways:

1. Browse pre-built servers:
   - Model Context Protocol reference servers: https://github.com/modelcontextprotocol/reference-servers

2. Search on npm:
```bash
npm search @modelcontextprotocol/server
```
3. Add servers to your `configuration/ace.yml` under the `mcpServers` key (see the snippet above).

4. Create custom servers:
   - Use the MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
   - Follow the MCP spec: https://modelcontextprotocol.io/introduction

## Advanced Usage

Ace is designed to be a flexible component in your AI and automation workflows. Beyond the CLI and Web UI, you can integrate Ace's core agent capabilities into your own applications or have it communicate with other AI agents.

### Embedding Ace in Your Applications

When Ace runs in `web` mode (`ace --mode web`), it exposes a comprehensive REST API and a WebSocket interface with streaming support, allowing you to control and interact with the agent programmatically. This is ideal for building custom front-ends, backend integrations, or embedding Ace into existing platforms.

For detailed information on the available API endpoints and WebSocket communication protocol, please see the [Ace API and WebSocket Interface documentation](docs/api_and_websockets.md).

### Inter-Agent Communication with MCP

Ace embraces the Model Context Protocol (MCP) not just for connecting to tools, but also for **Agent-to-Agent communication**. This means Ace can:

1.  **Act as an MCP Client**: Connect to other AI agents that expose an MCP server interface, allowing Ace to delegate tasks or query other agents as if they were any other tool.
2.  **Act as an MCP Server**: Ace itself exposes an MCP server interface (see `src/app/api/mcp_handler.ts` and `src/app/api/a2a.ts`). This makes Ace discoverable and usable by other MCP-compatible agents or systems. Another agent could connect to Ace and utilize its configured tools and LLM capabilities.

This framework-agnostic approach allows Ace to participate in a broader ecosystem of AI agents, regardless of their underlying implementation. By defining an `AgentCard` (a standardized metadata file, based on A2A protocol, describing an agent's capabilities and MCP endpoint), Ace can be discovered and interact with other agents seamlessly.

This powerful A2A capability opens up possibilities for creating sophisticated multi-agent systems where different specialized agents collaborate to achieve complex goals.

### Streaming & Voice Features

Ace includes advanced streaming capabilities and voice transcription:

- **Real-time Streaming**: Get AI responses as they're generated using the Vercel AI SDK
- **Voice Input**: Powered by Groq's Whisper models for fast, accurate transcription
- **Multi-modal**: Combine voice input with streaming text output for natural conversations
- **OpenRouter Integration**: Access to Qwen models and hundreds of others with unified pricing

## Hackathon Features

This project was specifically built for the **Cerebras and OpenRouter hackathon** to showcase:

- **Qwen Model Integration**: Leveraging `qwen/qwen3-32b:nitro` for advanced tool-calling capabilities
- **OpenRouter API**: Unified access to hundreds of AI models with transparent pricing
- **Real-time Streaming**: Immediate response streaming for better user experience
- **Voice-to-Text**: Groq-powered transcription for natural voice interactions
- **Tool Orchestration**: Seamless integration with external tools and services

## Documentation

Find detailed guides, architecture, and API reference in the `docs/` folder:

- [High-level design](docs/architecture.md)
- [Docker usage](README.Docker.md)
- [API Endpoints](docs/api_and_websockets.md)
- [Voice Transcription Setup](docs/speech-to-text.md)
- [Streaming Configuration](docs/streaming.md)

## Community & Support

Built by [@safzanpirani](https://github.com/safzanpirani) for the Cerebras and OpenRouter hackathon.

If you're enjoying Ace, please give us a ⭐ on GitHub!