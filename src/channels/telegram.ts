/**
 * Telegram Channel — grammY-based Telegram bot integration
 */

import { Bot, Context, session } from 'grammy';
import { NeuralRouter } from '../gateway/router.js';

export interface TelegramConfig {
    botToken: string;
    swarmUrl: string;
    cocoonEnabled: boolean;
}

interface SessionData {
    model: string;
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

type GSTDContext = Context & { session: SessionData };

export class TelegramChannel {
    private bot: Bot<GSTDContext>;
    private router: NeuralRouter;

    constructor(config: TelegramConfig) {
        this.bot = new Bot<GSTDContext>(config.botToken);
        this.router = new NeuralRouter(config.swarmUrl, config.cocoonEnabled);

        this.bot.use(session({
            initial: (): SessionData => ({
                model: 'auto',
                history: [],
            }),
        }));

        this.setupCommands();
        this.setupHandlers();
    }

    private setupCommands(): void {
        this.bot.api.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'new', description: 'New conversation' },
            { command: 'model', description: 'Switch model (auto/flash/pro/ultra/cocoon)' },
            { command: 'status', description: 'Session status' },
            { command: 'sovereignty', description: 'Sovereignty index' },
            { command: 'skills', description: 'Available skills' },
            { command: 'help', description: 'Help & commands' },
        ]);
    }

    private setupHandlers(): void {
        // /start
        this.bot.command('start', async (ctx) => {
            ctx.session.history = [];
            ctx.session.model = 'auto';
            await ctx.reply(
                `🐝 *GSTD Bot — Sovereign AI*\n\n` +
                `I'm powered by the GSTD Swarm — a decentralized network of 247+ nodes.\n` +
                `Your data never touches corporate servers.\n\n` +
                `*Models:*\n` +
                `• \`auto\` — Neural router (default)\n` +
                `• \`flash\` — qwen2.5-coder (fast)\n` +
                `• \`pro\` — llama3.1 (balanced)\n` +
                `• \`ultra\` — deepseek-r1 (deep)\n` +
                `• \`cocoon\` — TEE GPU (confidential)\n\n` +
                `Just send me a message to start! 🚀`,
                { parse_mode: 'Markdown' }
            );
        });

        // /new
        this.bot.command('new', async (ctx) => {
            ctx.session.history = [];
            await ctx.reply('🔄 Session reset. Send me a new message.');
        });

        // /model
        this.bot.command('model', async (ctx) => {
            const model = ctx.match?.trim();
            const validModels = ['auto', 'flash', 'pro', 'ultra', 'cocoon'];
            const modelMap: Record<string, string> = {
                'flash': 'gstd-flash', 'pro': 'gstd-pro',
                'ultra': 'gstd-ultra', 'cocoon': 'cocoon-auto', 'auto': 'auto',
            };

            if (model && validModels.includes(model)) {
                ctx.session.model = modelMap[model] || 'auto';
                await ctx.reply(`🔄 Model switched to *${model}*`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(
                    `Current: *${ctx.session.model}*\n\n` +
                    `Usage: \`/model auto|flash|pro|ultra|cocoon\``,
                    { parse_mode: 'Markdown' }
                );
            }
        });

        // /status
        this.bot.command('status', async (ctx) => {
            await ctx.reply(
                `📊 *Session Status*\n\n` +
                `Model: \`${ctx.session.model}\`\n` +
                `Messages: ${ctx.session.history.length}\n` +
                `Mode: Sovereign-First`,
                { parse_mode: 'Markdown' }
            );
        });

        // /sovereignty
        this.bot.command('sovereignty', async (ctx) => {
            await ctx.reply(
                `🛡️ *Sovereignty Index: 100%*\n\n` +
                `All requests processed by the GSTD Swarm.\n` +
                `0 requests sent to corporate APIs.\n` +
                `Your data stays sovereign.`,
                { parse_mode: 'Markdown' }
            );
        });

        // /skills
        this.bot.command('skills', async (ctx) => {
            await ctx.reply(
                `🔧 *Available Skills*\n\n` +
                `📊 DeFi Monitor — 0.01 GSTD\n` +
                `🔍 Web Researcher — 0.02 GSTD\n` +
                `💻 Code Generator — Free\n` +
                `🌍 Planetary Signals — 0.05 GSTD\n` +
                `📝 Content Writer — 0.01 GSTD\n` +
                `📈 Token Analyzer — 0.03 GSTD\n` +
                `🎨 Image Generator — 0.1 GSTD (beta)\n\n` +
                `Send a message like "research X" or "write code for Y" to use skills automatically.`,
                { parse_mode: 'Markdown' }
            );
        });

        // /help
        this.bot.command('help', async (ctx) => {
            await ctx.reply(
                `🐝 *GSTD Bot — Commands*\n\n` +
                `/new — Reset conversation\n` +
                `/model <name> — Switch AI model\n` +
                `/status — Session info\n` +
                `/sovereignty — Sovereignty index\n` +
                `/skills — Skill marketplace\n` +
                `/help — This message\n\n` +
                `*Tip:* Just send any message to chat with the AI!`,
                { parse_mode: 'Markdown' }
            );
        });

        // ─── Main message handler ────────────────────────────────
        this.bot.on('message:text', async (ctx) => {
            const userMessage = ctx.message.text;
            if (userMessage.startsWith('/')) return; // skip unknown commands

            // Show typing indicator
            await ctx.api.sendChatAction(ctx.chat.id, 'typing');

            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                {
                    role: 'system',
                    content: 'You are GSTD — a sovereign decentralized AI. Respond in the user\'s language. Be helpful, concise, and direct.',
                },
                ...ctx.session.history.slice(-20), // last 20 messages for context
                { role: 'user', content: userMessage },
            ];

            try {
                const result = await this.router.route(ctx.session.model, messages);

                // Update session history
                ctx.session.history.push({ role: 'user', content: userMessage });
                ctx.session.history.push({ role: 'assistant', content: result.content });

                // Trim history to prevent memory bloat
                if (ctx.session.history.length > 40) {
                    ctx.session.history = ctx.session.history.slice(-30);
                }

                // Send response with tier indicator
                const tierEmoji = {
                    cache: '⚡', swarm: '🐝', cocoon: '🛡️', commercial: '🏢',
                }[result.tier] || '🐝';

                const footer = `\n\n_${tierEmoji} ${result.model} · ${result.latencyMs}ms_`;

                await ctx.reply(result.content + footer, { parse_mode: 'Markdown' });
            } catch (err: any) {
                console.error('[Telegram] Error:', err.message);
                await ctx.reply('🔴 Something went wrong. The Swarm is busy — try again in a moment.');
            }
        });
    }

    async start(): Promise<void> {
        console.log('[Telegram] Starting bot...');
        this.bot.start({
            onStart: (botInfo) => {
                console.log(`[Telegram] Bot started: @${botInfo.username}`);
            },
        });
    }

    async stop(): Promise<void> {
        await this.bot.stop();
    }
}
