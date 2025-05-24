import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Partials, Attachment } from 'discord.js';
import https from 'https';
import http from 'http'; // ADDED for http support
import { AceAgent } from '@core/index.js';

// Load environment variables
dotenv.config();
const token = process.env.DISCORD_BOT_TOKEN;

// User-based cooldown system for Discord interactions
const userCooldowns = new Map<string, number>();
const RATE_LIMIT_ENABLED = process.env.DISCORD_RATE_LIMIT_ENABLED?.toLowerCase() !== 'false'; // default-on
let COOLDOWN_SECONDS = Number(process.env.DISCORD_RATE_LIMIT_SECONDS ?? 5);

if (Number.isNaN(COOLDOWN_SECONDS) || COOLDOWN_SECONDS < 0) {
    console.error(
        'DISCORD_RATE_LIMIT_SECONDS must be a non-negative number. Defaulting to 5 seconds.'
    );
    COOLDOWN_SECONDS = 5; // Default to a safe value
}

// Helper to download a file URL and convert it to base64
async function downloadFileAsBase64(
    fileUrl: string
): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const protocol = fileUrl.startsWith('https:') ? https : http; // Determine protocol
        const MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
        let downloadedBytes = 0;

        const req = protocol.get(fileUrl, (res) => {
            // Store the request object
            if (res.statusCode && res.statusCode >= 400) {
                // Clean up response stream
                res.resume();
                return reject(
                    new Error(`Failed to download file: ${res.statusCode} ${res.statusMessage}`)
                );
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (downloadedBytes > MAX_BYTES) {
                    // Clean up response stream before destroying request
                    res.resume();
                    req.destroy(new Error('Attachment exceeds 5 MB limit')); // Destroy the request
                    // No explicit reject here, as 'error' on req should handle it or timeout will occur
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (req.destroyed) return; // If request was destroyed due to size limit, do nothing
                const buffer = Buffer.concat(chunks);
                const contentType =
                    (res.headers['content-type'] as string) || 'application/octet-stream';
                resolve({ base64: buffer.toString('base64'), mimeType: contentType });
            });
            // Handle errors on the response stream itself (e.g., premature close)
            res.on('error', (err) => {
                if (!req.destroyed) {
                    // Avoid double-rejection if req.destroy() already called this
                    reject(err);
                }
            });
        });

        // Handle errors on the request object (e.g., socket hang up, DNS resolution error, or from req.destroy())
        req.on('error', (err) => {
            reject(err);
        });

        // Optional: Add a timeout for the request
        req.setTimeout(30000, () => {
            // 30 seconds timeout
            if (!req.destroyed) {
                req.destroy(new Error('File download timed out'));
            }
        });
    });
}

// Insert initDiscordBot to wire up a Discord client given pre-initialized services
export function startDiscordBot(agent: AceAgent) {
    if (!token) {
        throw new Error('DISCORD_BOT_TOKEN is not set');
    }

    const agentEventBus = agent.agentEventBus;

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
    });

    client.once('ready', () => {
        console.log(`Discord bot logged in as ${client.user.tag}`);
    });

    // ── REPLACE your entire old messageCreate handler with this ──
    client.on('messageCreate', async (message) => {
        // 1. Always ignore other bots
        //if (message.author.bot) return;

        // 2. Is this a DM?
        const isDM = !message.guild;
        const content = message.content || '';

        // 3. Look for "!ask " anywhere in the content (case-sensitive)
        const askIndex = content.indexOf('!ask ');
        if (!isDM && askIndex === -1) {
            // not a DM and no "!ask " found → ignore
            return;
        }

        // 4. Extract the user's prompt
        let userText: string;
        if (isDM) {
            // In DMs, take the entire message
            userText = content.trim();
        } else {
            // In a guild channel, take only what's after the first "!ask "
            userText = content.slice(askIndex + 5).trim();
        }
        if (!userText) return; // nothing to ask

        // 5. Rate‐limit check (same as before)
        if (RATE_LIMIT_ENABLED && COOLDOWN_SECONDS > 0) {
            const now = Date.now();
            const cooldownEnd = userCooldowns.get(message.author.id) || 0;
            if (now < cooldownEnd) {
                const timeLeft = ((cooldownEnd - now) / 1000).toFixed(1);
                try {
                    await message.reply(
                        `Please wait ${timeLeft} more seconds before using this command again.`
                    );
                } catch (err) {
                    console.error('Error sending cooldown message:', err);
                }
                return;
            }
        }

        // 6. Handle attachments exactly as before
        let imageDataInput: any;
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment?.url) {
                try {
                    const { base64, mimeType } = await downloadFileAsBase64(attachment.url);
                    imageDataInput = { image: base64, mimeType };
                } catch (err) {
                    console.error('Attachment download error:', err);
                    await message.reply(`Error downloading attachment: ${err.message}`);
                    return;
                }
            }
        }

        // 7. Subscribe to toolCall events
        const toolCallHandler = (toolName: string, args: any) => {
            message.channel
                .send(`⚙️ Calling tool **${toolName}** with args: ${JSON.stringify(args)}`)
                .catch(console.error);
        };
        agentEventBus.on('llmservice:toolCall', toolCallHandler);

        // 8. Actually run the agent
        try {
            await message.channel.sendTyping();
            const responseText = await agent.run(userText, imageDataInput);

            // handle Discord’s 2000-char limit
            const MAX = 1900;
            if (responseText.length <= MAX) {
                await message.reply(responseText);
            } else {
                let rest = responseText;
                let first = true;
                while (rest.length) {
                    const chunk = rest.slice(0, MAX);
                    rest = rest.slice(MAX);
                    if (first) {
                        await message.reply(chunk);
                        first = false;
                    } else {
                        // small delay for ordering / rate-limit safety
                        await new Promise((r) => setTimeout(r, 250));
                        await message.channel.send(chunk);
                    }
                }
            }
        } catch (err: any) {
            console.error('Error handling Discord message', err);
            await message.reply(`Error: ${err.message}`);
        } finally {
            agentEventBus.off('llmservice:toolCall', toolCallHandler);
            if (RATE_LIMIT_ENABLED && COOLDOWN_SECONDS > 0) {
                userCooldowns.set(message.author.id, Date.now() + COOLDOWN_SECONDS * 1000);
            }
        }
    });
    // ── end replacement ──

    client.login(token);
    return client;
}
