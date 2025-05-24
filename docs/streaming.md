# Streaming in Ace

Ace now supports streaming responses from LLM providers, providing a more interactive and responsive user experience. This document explains how streaming works and how to use it in different contexts.

## What is Streaming?

Streaming allows the AI's response to be displayed incrementally as it's being generated, rather than waiting for the complete response before showing anything. This provides several benefits:

1. **Improved User Experience**: Users see the AI's thoughts in real-time, making interactions feel more natural and conversational.
2. **Faster Initial Response**: The first part of the response appears immediately, reducing perceived latency.
3. **Progress Visibility**: Users can see that the system is working, even for longer responses.

## How to Use Streaming

### In the CLI

Streaming is enabled by default in the CLI. As you interact with Ace, you'll see responses appear incrementally in the response box.

You can control streaming with these commands:

- `streaming on` - Enable streaming (default)
- `streaming off` - Disable streaming

### In Code

If you're using Ace as a library in your own application, you can use the streaming API:

```typescript
import { AceAgent } from '@safzanpirani/ace';

// Initialize your agent
const agent = new AceAgent(services);

// Use streaming mode
await agent.runStreaming('Tell me about quantum computing');

// Or use the run method with streaming flag
await agent.run('Tell me about quantum computing', undefined, true);
```

To handle streaming events in your application, subscribe to the agent's event bus:

```typescript
agent.agentEventBus.on('llmservice:chunk', (text) => {
  // Handle each chunk of the response as it arrives
  console.log(text);
});

agent.agentEventBus.on('llmservice:response', (text) => {
  // Handle the complete response when it's finished
  console.log('Complete response:', text);
});
```

### Via the API

When using Ace's API, you can receive streaming responses via WebSocket connections. The WebSocket server emits the following events:

- `thinking` - The AI is thinking about the response
- `chunk` - A new chunk of the response is available
- `toolCall` - The AI is calling a tool
- `toolResult` - A tool has returned a result
- `response` - The complete response is available
- `error` - An error occurred
- `conversationReset` - The conversation history was reset

Example WebSocket client:

```javascript
const socket = new WebSocket('ws://localhost:3000');

socket.onmessage = (event) => {
  const { event: eventType, data } = JSON.parse(event.data);
  
  if (eventType === 'chunk') {
    // Handle streaming chunk
    appendToResponse(data.text);
  } else if (eventType === 'response') {
    // Handle complete response
    finalizeResponse(data.text);
  }
};

// Send a message
socket.send(JSON.stringify({ 
  type: 'message',
  content: 'Tell me about quantum computing'
}));
```

## Technical Details

### Supported LLM Providers

Streaming is supported for the following LLM providers:

- OpenAI (via the OpenAI API)
- Google (via the Vercel AI SDK)
- Anthropic (via the Vercel AI SDK)

### Implementation Notes

The streaming implementation uses different approaches based on the provider:

- For OpenAI, we use the native streaming API with `stream: true`
- For Google and Anthropic, we use the Vercel AI SDK's `streamText` function

The system emits `llmservice:chunk` events for each piece of the response, which are handled by the CLI and WebSocket subscribers.

### Handling Tool Calls

When streaming is enabled and the AI decides to call a tool, the streaming will pause while the tool executes, then resume with the next part of the response.

## Troubleshooting

If you encounter issues with streaming:

1. **Flickering in CLI**: This can happen if the response is updating too quickly. We've implemented throttling to minimize this issue.
2. **Incomplete Responses**: If responses appear cut off, try disabling streaming with `streaming off` to see if the issue persists.
3. **WebSocket Connection Issues**: Ensure your WebSocket client is properly handling reconnection and error cases.

For any other issues, please report them on our GitHub repository. 