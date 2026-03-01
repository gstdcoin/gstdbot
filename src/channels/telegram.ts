/**
 * Telegram Channel — grammY-based Telegram bot integration
 * + Community Guardian for group chats
 */

import { Bot, Context, session } from 'grammy';
import { NeuralRouter } from '../gateway/router.js';
import { CommunityGuardian } from './guardian.js';

export interface TelegramConfig {
    botToken: string;
    swarmUrl: string;
    cocoonEnabled: boolean;
    adminIds?: number[];
    communityChat?: number;  // Group chat ID for buy alerts
}

interface SessionData {
    model: string;
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

type GSTDContext = Context & { session: SessionData };

export class TelegramChannel {
    private bot: Bot<GSTDContext>;
    private router: NeuralRouter;
    private guardian: CommunityGuardian;
    private config: TelegramConfig;

    constructor(config: TelegramConfig) {
        this.config = config;
        this.bot = new Bot<GSTDContext>(config.botToken);
        this.router = new NeuralRouter(config.swarmUrl, config.cocoonEnabled);

        this.guardian = new CommunityGuardian({
            swarmUrl: config.swarmUrl,
            botUsername: '',  // Will be set on start
            adminIds: config.adminIds || [],
            enableBuyAlerts: !!config.communityChat,
            buyAlertChatId: config.communityChat,
        });

        this.bot.use(session({
            initial: (): SessionData => ({
                model: 'auto',
                history: [],
            }),
        }));

        // Register Guardian BEFORE other handlers (it needs to check spam first)
        this.guardian.registerHandlers(this.bot);

        this.setupCommands();
        this.setupHandlers();
    }

    private setupCommands(): void {
        this.bot.api.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'new', description: 'New conversation' },
            { command: 'model', description: 'Switch model' },
            { command: 'status', description: 'Session status' },
            { command: 'help', description: 'Help & commands' },
        ]);

        // Group commands
        this.bot.api.setMyCommands([
            { command: 'gstd', description: 'About GSTD platform' },
            { command: 'price', description: 'Current GSTD price' },
            { command: 'buy', description: 'How to buy GSTD' },
            { command: 'stats', description: 'Network statistics' },
            { command: 'help', description: 'Help & commands' },
        ], { scope: { type: 'all_group_chats' } });
    }

    private setupHandlers(): void {
        // ── Private chat handlers ──

        // /start
        this.bot.command('start', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            ctx.session.history = [];
            ctx.session.model = 'auto';
            await ctx.reply(
                `🐝 *GSTD — Sovereign AI Assistant*\n\n` +
                `I'm powered by the GSTD decentralized network.\n` +
                `Your data stays private and sovereign.\n\n` +
                `Just send me a message to start!\n\n` +
                `🌐 Dashboard: app.gstdtoken.com\n` +
                `💬 Web Chat: app.gstdtoken.com/chat\n\n` +
                `_Commands: /new /model /status /help_`,
                { parse_mode: 'Markdown' }
            );
        });

        // /new
        this.bot.command('new', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            ctx.session.history = [];
            await ctx.reply('🔄 Conversation reset. Send me a message!');
        });

        // /model
        this.bot.command('model', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            const model = ctx.match?.trim();
            const validModels = ['auto', 'flash', 'pro', 'ultra'];
            const modelMap: Record<string, string> = {
                'flash': 'gstd-flash', 'pro': 'gstd-pro',
                'ultra': 'gstd-ultra', 'auto': 'auto',
            };

            if (model && validModels.includes(model)) {
                ctx.session.model = modelMap[model] || 'auto';
                await ctx.reply(`✅ Model: *${model}*`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(
                    `Current model: *${ctx.session.model}*\n\n` +
                    `Available: auto, flash, pro, ultra\n` +
                    `Usage: \`/model auto\``,
                    { parse_mode: 'Markdown' }
                );
            }
        });

        // /status
        this.bot.command('status', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            await ctx.reply(
                `📊 *Session*\n\n` +
                `Model: \`${ctx.session.model}\`\n` +
                `Messages: ${ctx.session.history.length}`,
                { parse_mode: 'Markdown' }
            );
        });

        // /help — works in both private and group
        this.bot.command('help', async (ctx) => {
            if (ctx.chat?.type === 'private') {
                await ctx.reply(
                    `🐝 *GSTD Bot*\n\n` +
                    `/new — Reset conversation\n` +
                    `/model — Switch AI model\n` +
                    `/status — Session info\n` +
                    `/help — This message\n\n` +
                    `Just send any message to chat!`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(
                    `🐝 *GSTD Bot — Group Commands*\n\n` +
                    `/gstd — About GSTD platform\n` +
                    `/price — Token price\n` +
                    `/stats — Network stats\n\n` +
                    `Tag @${this.bot.botInfo?.username} to ask me anything!`,
                    { parse_mode: 'Markdown' }
                );
            }
        });

        // ── Main message handler (private chat AI + group @mentions) ──
        this.bot.on('message:text', async (ctx) => {
            const text = ctx.message?.text || '';
            if (text.startsWith('/')) return; // skip unknown commands

            const isPrivate = ctx.chat?.type === 'private';
            const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
            const isMentioned = text.toLowerCase().includes(`@${this.bot.botInfo?.username?.toLowerCase()}`);
            const isReply = ctx.message?.reply_to_message?.from?.id === this.bot.botInfo?.id;

            // In groups, only respond when mentioned or replied to
            if (isGroup && !isMentioned && !isReply) return;

            // Clean the mention from the message
            const cleanMessage = text.replace(new RegExp(`@${this.bot.botInfo?.username}`, 'gi'), '').trim();
            if (!cleanMessage) return;

            // Show typing
            await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

            const systemPrompt = isGroup
                ? 'You are GSTD Bot in a community group chat. Be helpful and concise. You can tell about the GSTD platform, its features (decentralized AI, token economy, swarm computing), pricing, and how to use it. NEVER share API keys, server details, database info, or internal architecture. Respond in the user\'s language. Keep answers under 200 words for group chat.'
                : 'You are GSTD — a sovereign decentralized AI. Respond in the user\'s language. Be helpful, concise, and direct.';

            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                { role: 'system', content: systemPrompt },
                ...(isPrivate ? ctx.session.history.slice(-20) : []),
                { role: 'user', content: cleanMessage },
            ];

            try {
                const result = await this.router.route(ctx.session.model || 'auto', messages);

                if (isPrivate) {
                    ctx.session.history.push({ role: 'user', content: cleanMessage });
                    ctx.session.history.push({ role: 'assistant', content: result.content });
                    if (ctx.session.history.length > 40) {
                        ctx.session.history = ctx.session.history.slice(-30);
                    }
                }

                const footer = isPrivate
                    ? `\n\n_🐝 ${result.model} · ${result.latencyMs}ms_`
                    : '';

                await ctx.reply(result.content + footer, {
                    parse_mode: 'Markdown',
                    reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                });
            } catch (err: any) {
                console.error('[Telegram] Error:', err.message);
                await ctx.reply('Something went wrong. Try again in a moment.', {
                    reply_to_message_id: ctx.message?.message_id,
                });
            }
        });
    }

    async start(): Promise<void> {
        console.log('[Telegram] Starting bot...');
        this.bot.start({
            onStart: (botInfo) => {
                console.log(`[Telegram] Bot started: @${botInfo.username}`);
                // Pass username to guardian for @mention detection
                (this.guardian as any).config.botUsername = botInfo.username;

                // Start buy alerts if community chat is configured
                if (this.config.communityChat) {
                    this.guardian.startBuyAlerts(this.bot, this.config.communityChat);
                }
            },
        });
    }

    async stop(): Promise<void> {
        await this.bot.stop();
    }
}
