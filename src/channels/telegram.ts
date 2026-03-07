/**
 * Telegram Channel — grammY-based Telegram bot integration
 * + Community Guardian for group chats
 * + Factuality System Prompt (same as chat.gstdtoken.com)
 * + Redis Knowledge Cache (shared with web chat)
 */

import { Bot, Context, session } from 'grammy';
import { NeuralRouter, type SmartMixTier, SMARTMIX_TIERS, formatCost, getGstdPrice } from '../gateway/router.js';
import { CommunityGuardian } from './guardian.js';
import net from 'net';
import crypto from 'crypto';

// ─── Factuality System Prompt (identical to chat.gstdtoken.com) ───
const FACTUALITY_PROMPT = `You are a knowledgeable AI assistant that ONLY provides verified, factual information.

CRITICAL RULES:
1. ONLY state facts you are confident are true and widely accepted
2. When citing information, reference the source type (e.g., "According to scientific research...", "Per official documentation...", "Based on established data...")
3. If you are NOT CERTAIN about something, say "I'm not sure about this" or "This may not be accurate" — NEVER fabricate facts
4. Distinguish clearly between established facts, expert opinions, and your inferences
5. For numerical data (statistics, dates, measurements), only provide values you are confident about
6. If asked about recent events you may not have data on, explicitly state your knowledge cutoff
7. Prefer concise, accurate answers over lengthy uncertain ones
8. Use markdown formatting for clarity

Your goal is to be TRUSTWORTHY — users rely on you for accurate information. Being honest about uncertainty is better than being confidently wrong.`;

// ─── Redis Knowledge Cache (shared with web chat) ─────────────────
const KNOWLEDGE_CACHE_TTL = 86400; // 24 hours

function makeKnowledgeKey(question: string): string {
    const normalized = question.toLowerCase().trim().replace(/\s+/g, ' ');
    return `gstd:knowledge:${crypto.createHash('md5').update(normalized).digest('hex')}`;
}

function redisCommand(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let response = '';
        let resolved = false;
        const done = (val: string | null) => {
            if (resolved) return;
            resolved = true;
            socket.destroy();
            resolve(val);
        };
        socket.setTimeout(2000);
        socket.connect(6379, '127.0.0.1', () => {
            const cmd = `*${args.length}\r\n${args.map(a => `$${Buffer.byteLength(a)}\r\n${a}`).join('\r\n')}\r\n`;
            socket.write(cmd);
        });
        socket.on('data', (data) => {
            response += data.toString();
            if (response.startsWith('$-1\r\n')) return done(null);
            if (response.startsWith('-')) return done(null);
            if (response.startsWith('+') && response.includes('\r\n')) {
                return done(response.slice(1, response.indexOf('\r\n')));
            }
            const sizeMatch = response.match(/^\$(\d+)\r\n/);
            if (sizeMatch) {
                const expectedLen = parseInt(sizeMatch[1]);
                const dataStart = sizeMatch[0].length;
                if (response.length >= dataStart + expectedLen + 2) {
                    return done(response.substring(dataStart, dataStart + expectedLen));
                }
            }
        });
        socket.on('error', () => done(null));
        socket.on('timeout', () => done(null));
    });
}

async function redisGet(key: string): Promise<string | null> {
    return redisCommand(['GET', key]);
}

async function redisSet(key: string, value: string, ttl: number): Promise<void> {
    await redisCommand(['SET', key, value, 'EX', String(ttl)]);
}

async function saveToKnowledge(question: string, answer: string, model: string): Promise<void> {
    try {
        const key = makeKnowledgeKey(question);
        const data = JSON.stringify({ answer, model, timestamp: Date.now() });
        await redisSet(key, data, KNOWLEDGE_CACHE_TTL);
    } catch { /* ignore cache write failures */ }
}

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

    /** Authenticated API call to Go backend */
    private async apiCall(path: string, opts?: { method?: string; body?: any }): Promise<any> {
        const url = `${this.config.swarmUrl}${path}`;
        const res = await fetch(url, {
            method: opts?.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Token': this.config.botToken,
            },
            body: opts?.body ? JSON.stringify(opts.body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`API ${res.status}: ${text.substring(0, 100)}`);
        }
        return res.json();
    }

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

        // Global error handler — catches ALL errors
        this.bot.catch((err) => {
            console.error('[Bot] Unhandled error:', err.error);
            console.error('[Bot] Update that caused error:', JSON.stringify(err.ctx?.update).substring(0, 200));
        });

        this.bot.use(session({
            initial: (): SessionData => ({
                model: 'auto',
                history: [],
            }),
        }));

        // Log all incoming updates for debugging
        this.bot.use(async (ctx, next) => {
            const chatType = ctx.chat?.type || 'unknown';
            const text = ctx.message?.text || ctx.callbackQuery?.data || '';
            console.log(`[Bot] ${chatType} | ${ctx.from?.id} | ${text.substring(0, 50)}`);
            await next();
        });

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

    private lang(ctx: any): string {
        return ctx.from?.language_code?.startsWith('ru') ? 'ru' : 'en';
    }

    private mainKeyboard(lang: string) {
        if (lang === 'ru') {
            return {
                keyboard: [
                    [{ text: '💎 Баланс' }, { text: '⭐️ Пополнить' }],
                    [{ text: '🔗 Кошелек' }, { text: '🧠 Заработать' }],
                    [{ text: '🧠 Интеллект' }, { text: '📖 Помощь' }],
                ],
                resize_keyboard: true,
                is_persistent: true,
            };
        }
        return {
            keyboard: [
                [{ text: '💎 Balance' }, { text: '⭐️ Top Up' }],
                [{ text: '🔗 Wallet' }, { text: '🧠 Earn' }],
                [{ text: '🧠 Intelligence' }, { text: '📖 Help' }],
            ],
            resize_keyboard: true,
            is_persistent: true,
        };
    }

    private setupHandlers(): void {
        // ── /start — Welcome + deep link handling ──
        this.bot.command('start', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            ctx.session.history = [];
            ctx.session.model = 'auto';
            const lang = this.lang(ctx);

            // Parse deep link payload: /start sponsor-{signalId}-{starsCost}
            const payload = ctx.match?.toString().trim() || '';
            console.log(`[Bot] /start payload: "${payload}"`);

            if (payload.startsWith('sponsor-')) {
                // Format: sponsor-{signalId}-{starsCost}
                // Example: sponsor-nasa_eosdis-3500
                const parts = payload.replace('sponsor-', '').split('-');
                const starsCost = parseInt(parts[parts.length - 1]);
                const signalId = parts.slice(0, parts.length - 1).join('-');

                if (signalId && starsCost > 0) {
                    console.log(`[Bot] Deep link sponsor: signal=${signalId} stars=${starsCost}`);
                    return this.handleSponsorDeepLink(ctx, lang, signalId, starsCost);
                }
            }

            if (payload.startsWith('buy')) {
                // Direct buy link
                return this.handleTopUp(ctx, lang);
            }

            const s = SMARTMIX_TIERS;
            const msg = lang === 'ru'
                ? `🐝 <b>GSTD — Коллективный Интеллект</b>\n\n` +
                `🆓 <b>Бесплатно:</b> 1 эксперт — просто пиши и ИИ ответит мгновенно.\n\n` +
                `🧠 <b>Платные уровни:</b>\n` +
                `🔬 Совет из 3 (${s.standard.cost.toFixed(1)} GSTD ≈ $${s.standard.costUsd}) — 3 эксперта + консенсус\n` +
                `🔥 Панель из 5 (${s.pro.cost.toFixed(1)} GSTD ≈ $${s.pro.costUsd}) — глубокий анализ\n` +
                `🧠 Рой из 7 (${s.ultra.cost.toFixed(1)} GSTD ≈ $${s.ultra.costUsd}) — полная верификация\n\n` +
                `💡 <i>Нажми 🧠 Интеллект чтобы выбрать уровень.</i>`
                : `🐝 <b>GSTD — Collective Intelligence</b>\n\n` +
                `🆓 <b>Free:</b> 1 expert — just type and AI responds instantly.\n\n` +
                `🧠 <b>Paid tiers:</b>\n` +
                `🔬 Council of 3 (${s.standard.cost.toFixed(1)} GSTD ≈ $${s.standard.costUsd}) — 3 experts + consensus\n` +
                `🔥 Panel of 5 (${s.pro.cost.toFixed(1)} GSTD ≈ $${s.pro.costUsd}) — deep analysis\n` +
                `🧠 Swarm of 7 (${s.ultra.cost.toFixed(1)} GSTD ≈ $${s.ultra.costUsd}) — full verification\n\n` +
                `💡 <i>Tap 🧠 Intelligence to choose your level.</i>`;

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                reply_markup: this.mainKeyboard(lang),
            });
        });

        // ── /new ──
        this.bot.command('new', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            ctx.session.history = [];
            const lang = this.lang(ctx);
            await ctx.reply(lang === 'ru' ? '🔄 Диалог сброшен.' : '🔄 Conversation reset.');
        });

        // ── /help ──
        this.bot.command('help', async (ctx) => {
            await this.sendHelp(ctx);
        });

        // ── /model — Switch AI model / show available models ──
        this.bot.command('model', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            const lang = this.lang(ctx);

            const models = [
                { id: 'auto', label: '🤖 Auto (best available)', labelRU: '🤖 Авто (лучшая доступная)' },
                { id: 'llama-3.3-70b-versatile', label: '🦙 Llama 3.3 70B', labelRU: '🦙 Llama 3.3 70B' },
                { id: 'llama-3.1-8b-instant', label: '⚡ Llama 3.1 8B (fast)', labelRU: '⚡ Llama 3.1 8B (быстрая)' },
                { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: '🔭 Llama 4 Scout', labelRU: '🔭 Llama 4 Scout' },
                { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: '🚀 Llama 4 Maverick', labelRU: '🚀 Llama 4 Maverick' },
                { id: 'qwen/qwen3-32b', label: '🐉 Qwen3 32B', labelRU: '🐉 Qwen3 32B' },
                { id: 'openai/gpt-oss-120b', label: '🧠 GPT-OSS 120B', labelRU: '🧠 GPT-OSS 120B' },
                { id: 'openai/gpt-oss-20b', label: '💡 GPT-OSS 20B', labelRU: '💡 GPT-OSS 20B' },
                { id: 'moonshotai/kimi-k2-instruct', label: '🌙 Kimi K2', labelRU: '🌙 Kimi K2' },
            ];

            const current = ctx.session.model || 'auto';
            const currentLabel = models.find(m => m.id === current)?.[lang === 'ru' ? 'labelRU' : 'label'] || current;

            const msg = lang === 'ru'
                ? `🤖 <b>Выберите ИИ модель</b>\n\nТекущая: <b>${currentLabel}</b>\n\n<i>Все модели бесплатны • Sovereign AI</i>`
                : `🤖 <b>Choose AI Model</b>\n\nCurrent: <b>${currentLabel}</b>\n\n<i>All models are free • Sovereign AI</i>`;

            const buttons = models.map(m => {
                const isActive = m.id === current;
                const label = lang === 'ru' ? m.labelRU : m.label;
                return [{ text: `${isActive ? '✅ ' : ''}${label}`, callback_data: `model_${m.id}` }];
            });

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons },
            });
        });

        // ── /status — Session status ──
        this.bot.command('status', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            const lang = this.lang(ctx);
            const model = ctx.session.model || 'auto';
            const histLen = ctx.session.history?.length || 0;
            const mixTier = ((ctx.session as any).mixTier as SmartMixTier) || 'free';
            const tierInfo = SMARTMIX_TIERS[mixTier];

            const msg = lang === 'ru'
                ? `📊 <b>Статус сессии</b>\n\n` +
                  `🤖 Модель: <b>${model}</b>\n` +
                  `💬 Сообщений: <b>${histLen}</b>\n` +
                  `🧠 Интеллект: <b>${tierInfo.emoji} ${tierInfo.nameRU}</b>\n` +
                  `\n<i>Команды: /new — сбросить, /model — сменить модель</i>`
                : `📊 <b>Session Status</b>\n\n` +
                  `🤖 Model: <b>${model}</b>\n` +
                  `💬 Messages: <b>${histLen}</b>\n` +
                  `🧠 Intelligence: <b>${tierInfo.emoji} ${tierInfo.name}</b>\n` +
                  `\n<i>Commands: /new — reset, /model — switch model</i>`;

            await ctx.reply(msg, { parse_mode: 'HTML' });
        });

        // ── Main message handler ──
        this.bot.on('message:text', async (ctx) => {
            const text = ctx.message?.text || '';
            if (text.startsWith('/')) return;

            const isPrivate = ctx.chat?.type === 'private';
            const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
            const isMentioned = text.toLowerCase().includes(`@${this.bot.botInfo?.username?.toLowerCase()}`);
            const isReply = ctx.message?.reply_to_message?.from?.id === this.bot.botInfo?.id;

            if (isGroup && !isMentioned && !isReply) return;

            const lang = this.lang(ctx);

            // ── Button handlers (private only) ──
            if (isPrivate) {
                // 💎 Balance
                if (text === '💎 Balance' || text === '💎 Баланс') {
                    return this.handleBalance(ctx, lang);
                }
                // ⭐️ Top Up
                if (text === '⭐️ Top Up' || text === '⭐️ Пополнить' || text === '💰 Buy GSTD' || text === '💰 Купить GSTD') {
                    return this.handleTopUp(ctx, lang);
                }
                // 📖 Help
                if (text === '📖 Help' || text === '📖 Помощь' || text === 'ℹ️ About') {
                    return this.sendHelp(ctx);
                }
                // 📊 Stats
                if (text === '📊 Stats' || text === '📊 Статистика') {
                    return this.handleBalance(ctx, lang);
                }
                // 🔗 Wallet
                if (text === '🔗 Wallet' || text === '🔗 Кошелек') {
                    return this.handleWallet(ctx, lang);
                }
                // 🧠 Earn
                if (text === '🧠 Earn' || text === '🧠 Заработать') {
                    return this.handleEarn(ctx, lang);
                }
                // 🧠 Collective Intelligence
                if (text === '🧠 Интеллект' || text === '🧠 Intelligence' || text === '🔬 SmartMix') {
                    return this.handleSmartMixMenu(ctx, lang);
                }
                // 📱 App
                if (text === '📱 App' || text === '📱 Приложение') {
                    const msg = lang === 'ru'
                        ? '📱 <b>Откройте приложение:</b>\n\nhttps://app.gstdtoken.com'
                        : '📱 <b>Open the app:</b>\n\nhttps://app.gstdtoken.com';
                    return ctx.reply(msg, { parse_mode: 'HTML' });
                }
                // 🔗 TON Wallet Address Detection (EQ... or UQ... or 0:...)
                const tonAddressRegex = /^(EQ[A-Za-z0-9_-]{46}|UQ[A-Za-z0-9_-]{46}|0:[a-fA-F0-9]{64})$/;
                const trimmedText = text.trim();
                if (tonAddressRegex.test(trimmedText)) {
                    return this.handleLinkWallet(ctx, lang, trimmedText);
                }

                // 🔗 Connect Wallet button (from inline keyboard or text)
                if (text === '🔗 Connect Wallet' || text === '🔗 Подключить кошелёк' ||
                    text === '🔗 Кошелёк' || text.toLowerCase().includes('connect wallet')) {
                    return this.handleWallet(ctx, lang);
                }
            }

            // ── AI Chat ──
            const cleanMessage = text.replace(new RegExp(`@${this.bot.botInfo?.username}`, 'gi'), '').trim();
            if (!cleanMessage) return;

            console.log(`[AI] Processing: "${cleanMessage.substring(0, 40)}"`);
            await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

            const basePrompt = isGroup
                ? 'You are GSTD Bot in a community group chat. Be helpful and concise. Respond in the user\'s language. Keep answers under 200 words.'
                : 'You are GSTD — a sovereign decentralized AI powered by the Swarm. You have Collective Memory from all users. Respond in the user\'s language. Be helpful, concise, and direct.';

            // Inject factuality prompt (same as chat.gstdtoken.com)
            const systemPrompt = FACTUALITY_PROMPT + '\n\n' + basePrompt;

            // ── Check Redis Knowledge Cache before calling AI ──
            if (cleanMessage.length > 5) {
                try {
                    const cached = await redisGet(makeKnowledgeKey(cleanMessage));
                    if (cached) {
                        const knowledge = JSON.parse(cached);
                        if (knowledge.answer) {
                            console.log(`[AI] 📚 Knowledge cache hit: "${cleanMessage.substring(0, 40)}"`);
                            const cacheFooter = isPrivate ? `\n\n📚 Verified · ${knowledge.model || 'cached'} · instant` : '';
                            const fullResponse = knowledge.answer + cacheFooter;
                            const htmlResponse = this.markdownToTelegramHtml(fullResponse);
                            try {
                                await this.sendFormattedReply(ctx, htmlResponse, isGroup);
                            } catch {
                                await ctx.reply(fullResponse.substring(0, 4000), {
                                    reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                                });
                            }
                            if (isPrivate) {
                                ctx.session.history.push({ role: 'user', content: cleanMessage });
                                ctx.session.history.push({ role: 'assistant', content: knowledge.answer });
                                if (ctx.session.history.length > 40) {
                                    ctx.session.history = ctx.session.history.slice(-30);
                                }
                            }
                            return;
                        }
                    }
                } catch { /* cache miss, proceed normally */ }
            }

            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                { role: 'system', content: systemPrompt },
                ...(isPrivate ? ctx.session.history.slice(-20) : []),
                { role: 'user', content: cleanMessage },
            ];

            try {
                // Use SmartMix if tier is set in session, otherwise standard route
                const mixTier = (ctx.session as any).mixTier as SmartMixTier | undefined;

                if (mixTier && mixTier !== 'free') {
                    console.log(`[AI] Using SmartMix tier: ${mixTier}`);
                    await ctx.api.sendChatAction(ctx.chat!.id, 'typing');
                    const mixResult = await this.router.routeSmartMix(mixTier, messages);
                    console.log(`[AI] SmartMix response: ${mixResult.tier} ${mixResult.strategy} ${mixResult.latencyMs}ms`);

                    // Save SmartMix consensus to knowledge cache (highest quality answers)
                    if (cleanMessage.length > 5) {
                        saveToKnowledge(cleanMessage, mixResult.content, `smartmix-${mixResult.tier}`).catch(() => {});
                    }

                    if (isPrivate) {
                        ctx.session.history.push({ role: 'user', content: cleanMessage });
                        ctx.session.history.push({ role: 'assistant', content: mixResult.content });
                        if (ctx.session.history.length > 40) {
                            ctx.session.history = ctx.session.history.slice(-30);
                        }
                    }

                    const tierInfo = SMARTMIX_TIERS[mixResult.tier] || SMARTMIX_TIERS.free;
                    const footer = isPrivate
                        ? `\n\n${tierInfo.emoji} ${tierInfo.name} · ${mixResult.strategy} · ${mixResult.modelsUsed.length} models · ${mixResult.latencyMs}ms`
                        : '';

                    try {
                        await ctx.reply(mixResult.content + footer, {
                            reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                        });
                    } catch {
                        await ctx.reply((mixResult.content + footer).substring(0, 4000));
                    }
                    return;
                }

                console.log('[AI] Calling router.route...');
                const result = await this.router.route(ctx.session.model || 'auto', messages);
                console.log(`[AI] Got response: ${result.tier} ${result.model} ${result.latencyMs}ms len=${result.content.length}`);

                // Save to shared Redis knowledge cache (same as chat.gstdtoken.com)
                if (cleanMessage.length > 5 && result.tier !== 'cache' && result.tier !== 'fallback') {
                    saveToKnowledge(cleanMessage, result.content, result.model).catch(() => {});
                }

                if (isPrivate) {
                    ctx.session.history.push({ role: 'user', content: cleanMessage });
                    ctx.session.history.push({ role: 'assistant', content: result.content });
                    if (ctx.session.history.length > 40) {
                        ctx.session.history = ctx.session.history.slice(-30);
                    }
                }

                const tierLabel = result.tier === 'cache' ? '⚡' : '🆓';
                const footer = isPrivate
                    ? `\n\n${tierLabel} ${result.model} · ${result.latencyMs}ms`
                    : '';

                const fullResponse = result.content + footer;

                // Convert Markdown → Telegram HTML for rich formatting (like Claude/ChatGPT)
                const htmlResponse = this.markdownToTelegramHtml(fullResponse);

                // Send with HTML formatting, split long messages
                try {
                    await this.sendFormattedReply(ctx, htmlResponse, isGroup);
                    console.log('[AI] ✅ Reply sent successfully (HTML)');
                } catch (sendErr: any) {
                    console.error('[AI] ❌ HTML send error, trying plain:', sendErr.message);
                    // Fallback: send as plain text
                    try {
                        await ctx.reply(fullResponse.substring(0, 4000), {
                            reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                        });
                        console.log('[AI] ✅ Plain text fallback sent');
                    } catch (e2: any) {
                        console.error('[AI] ❌❌ Even plain failed:', e2.message);
                    }
                }
            } catch (err: any) {
                console.error('[Telegram] AI Error:', err.message);
                const errMsg = lang === 'ru'
                    ? '❌ Ошибка. Попробуйте через минуту.'
                    : '❌ Something went wrong. Try again in a moment.';
                await ctx.reply(errMsg, { reply_to_message_id: ctx.message?.message_id });
            }
        });

        // ── Pre-checkout query (REQUIRED by Telegram before Stars payment) ──
        this.bot.on('pre_checkout_query', async (ctx) => {
            // Always approve — validation happened at invoice creation time
            await ctx.answerPreCheckoutQuery(true);
        });

        // ── Successful payment handler (CRITICAL: credits GSTD to user wallet) ──
        this.bot.on('message:successful_payment', async (ctx) => {
            const payment = ctx.message?.successful_payment;
            if (!payment) return;

            const lang = this.lang(ctx);
            const telegramId = ctx.from?.id;
            const starsAmount = payment.total_amount; // in Stars (XTR = 1:1)
            const payload = payment.invoice_payload || '';

            console.log(`[Stars] ✅ Payment received: ${starsAmount}⭐ from user ${telegramId}`);

            try {
                const result = await this.apiCall('/api/v1/telegram/bot/topup', {
                    method: 'POST',
                    body: {
                        telegram_id: telegramId,
                        stars_amount: starsAmount,
                        telegram_payment_charge_id: payment.telegram_payment_charge_id,
                        provider_payment_charge_id: payment.provider_payment_charge_id || '',
                        payload: payload,
                    },
                });

                const gstdAmount = result.gstd_credited || 0;
                const walletAddress = result.wallet_address || '';
                const shortWallet = walletAddress ? walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4) : '';

                let msg: string;
                if (lang === 'ru') {
                    msg = `✅ <b>Оплата получена!</b>\n\n⭐ ${starsAmount} Stars → <b>${gstdAmount.toFixed(2)} GSTD</b> зачислено\n`;
                    if (shortWallet) {
                        msg += `💼 На кошелёк: <code>${shortWallet}</code>\n`;
                    } else {
                        msg += `💼 На внутренний баланс\n⚠️ <i>Привяжите TON-кошелёк кнопкой 🔗 Кошелек для вывода</i>\n`;
                    }
                    msg += `\n💡 Используй GSTD для Pro-запросов к Kimi K2 · LLaMA4 · GPT-OSS-120B!`;
                } else {
                    msg = `✅ <b>Payment received!</b>\n\n⭐ ${starsAmount} Stars → <b>${gstdAmount.toFixed(2)} GSTD</b> credited\n`;
                    if (shortWallet) {
                        msg += `💼 To wallet: <code>${shortWallet}</code>\n`;
                    } else {
                        msg += `💼 To internal balance\n⚠️ <i>Link TON wallet via 🔗 Wallet button to withdraw</i>\n`;
                    }
                    msg += `\n💡 Use GSTD for Pro requests to Kimi K2 · LLaMA4 · GPT-OSS-120B!`;
                }

                await ctx.reply(msg, { parse_mode: 'HTML' });
                console.log(`[Stars] ✅ Credited ${gstdAmount} GSTD to user ${telegramId}`);

            } catch (err: any) {
                console.error('[Stars] ❌ Topup API failed:', err.message);
                // Payment was received — notify user so they can contact support
                const errMsg = lang === 'ru'
                    ? `✅ Оплата получена (${starsAmount}⭐). Зачисляем GSTD...\n` +
                    `Если GSTD не появятся в течение 5 минут, напишите в поддержку.`
                    : `✅ Payment received (${starsAmount}⭐). Crediting GSTD...\n` +
                    `If GSTD doesn't appear within 5 minutes, contact support.`;
                await ctx.reply(errMsg);
            }
        });

        // ── Callback query handler (inline buttons) ──
        this.bot.on('callback_query:data', async (ctx) => {

            const data = ctx.callbackQuery.data;
            const lang = this.lang(ctx);

            if (data === 'claim_reward') {
                await ctx.answerCallbackQuery();
                try {
                    const result = await this.apiCall('/api/v1/telegram/bot/claim_reward', {
                        method: 'POST',
                        body: { telegram_id: ctx.from.id },
                    });
                    if (!result.success) {
                        const msg = lang === 'ru'
                            ? 'ℹ️ Нет наград. Включи 🧠 Заработать!'
                            : 'ℹ️ No rewards to claim. Tap 🧠 Earn!';
                        return ctx.reply(msg);
                    }
                    const msg = lang === 'ru'
                        ? `✅ <b>Награда получена!</b>\n\n💰 Зачислено: <b>${result.claimed_net.toFixed(4)} GSTD</b>\n🏗 Фонд развития: <b>${result.gold_reserve.toFixed(4)} GSTD</b> (10%)\n⚡ Фонд Sovereign AI: <b>${result.burned.toFixed(4)} GSTD</b> (5%)`
                        : `✅ <b>Reward Claimed!</b>\n\n💰 Received: <b>${result.claimed_net.toFixed(4)} GSTD</b>\n🏗 Development Fund: <b>${result.gold_reserve.toFixed(4)} GSTD</b> (10%)\n⚡ Sovereign AI Pool: <b>${result.burned.toFixed(4)} GSTD</b> (5%)`;
                    return ctx.reply(msg, { parse_mode: 'HTML' });
                } catch {
                    return ctx.reply('❌ Error claiming');
                }
            }

            if (data === 'buy_stars') {
                await ctx.answerCallbackQuery();
                return this.handleTopUp(ctx, lang);
            }

            // Handle link_wallet_prompt callback
            if (data === 'link_wallet_prompt') {
                await ctx.answerCallbackQuery();
                return this.handleWallet(ctx, lang);
            }

            // Handle tier buy buttons: buy_10, buy_50, buy_200
            if (data.startsWith('buy_')) {
                await ctx.answerCallbackQuery();
                const starsAmount = parseInt(data.replace('buy_', ''));
                if (!starsAmount || starsAmount <= 0) return;

                const STAR_USD = 0.013;
                let gstdPrice = 0;
                try {
                    const priceData = await this.apiCall('/api/v1/market/price');
                    gstdPrice = priceData.gstd_price_usd || 0;
                } catch { }
                const gstdPerStar = gstdPrice > 0 ? STAR_USD / gstdPrice : 10;
                const gstdAmount = Math.floor(starsAmount * gstdPerStar);
                const costPerReq = SMARTMIX_TIERS.standard.cost || 3.4;
                const proReqs = Math.floor(gstdAmount / costPerReq);
                const usd = (starsAmount * STAR_USD).toFixed(2);

                const title = lang === 'ru'
                    ? `${gstdAmount} GSTD (${proReqs} Pro запросов)`
                    : `${gstdAmount} GSTD (${proReqs} Pro requests)`;
                const desc = lang === 'ru'
                    ? `${starsAmount}⭐ = $${usd} = ${gstdAmount} GSTD. Курс: 1⭐ = ${gstdPerStar.toFixed(0)} GSTD`
                    : `${starsAmount}⭐ = $${usd} = ${gstdAmount} GSTD. Rate: 1⭐ = ${gstdPerStar.toFixed(0)} GSTD`;

                try {
                    await ctx.api.sendInvoice(
                        ctx.chat!.id,
                        title,
                        desc,
                        `gstd_purchase_${ctx.from.id}_${Date.now()}`,
                        'XTR',
                        [{ label: title, amount: starsAmount }],
                    );
                } catch (err: any) {
                    console.error('[TopUp] Invoice error:', err.message);
                    await ctx.reply(lang === 'ru' ? '❌ Ошибка создания счёта' : '❌ Error creating invoice');
                }
                return;
            }

            // SmartMix tier selection callbacks
            if (data.startsWith('smartmix_')) {
                await ctx.answerCallbackQuery();
                const selectedTier = data.replace('smartmix_', '') as SmartMixTier;
                (ctx.session as any).mixTier = selectedTier;

                const tierInfo = SMARTMIX_TIERS[selectedTier] || SMARTMIX_TIERS.free;
                const msg = lang === 'ru'
                    ? `${tierInfo.emoji} <b>${tierInfo.nameRU}</b> активирован!\n\n` +
                    `${tierInfo.cost > 0 ? `💰 Стоимость: ${tierInfo.cost} GSTD/запрос` : '🆓 Бесплатно'}\n\n` +
                    `<i>Пишите любой вопрос — ${tierInfo.expertCount} ${tierInfo.expertCount === 1 ? 'эксперт' : 'экспертов'} ответят${tierInfo.expertCount > 1 ? ' и синтезируют консенсус' : ''}.</i>`
                    : `${tierInfo.emoji} <b>${tierInfo.name}</b> activated!\n\n` +
                    `${tierInfo.cost > 0 ? `💰 Cost: ${tierInfo.cost} GSTD/request` : '🆓 Free'}\n\n` +
                    `<i>Type any question — ${tierInfo.expertCount} expert${tierInfo.expertCount > 1 ? 's' : ''} will respond${tierInfo.expertCount > 1 ? ' and synthesize consensus' : ''}.</i>`;

                return ctx.reply(msg, { parse_mode: 'HTML' });
            }

            // Model selection callbacks (from /model command)
            if (data.startsWith('model_')) {
                await ctx.answerCallbackQuery();
                const selectedModel = data.replace('model_', '');
                ctx.session.model = selectedModel;

                const modelNames: Record<string, { en: string; ru: string }> = {
                    'auto': { en: '🤖 Auto (best available)', ru: '🤖 Авто (лучшая доступная)' },
                    'llama-3.3-70b-versatile': { en: '🦙 Llama 3.3 70B', ru: '🦙 Llama 3.3 70B' },
                    'llama-3.1-8b-instant': { en: '⚡ Llama 3.1 8B', ru: '⚡ Llama 3.1 8B' },
                    'meta-llama/llama-4-scout-17b-16e-instruct': { en: '🔭 Llama 4 Scout', ru: '🔭 Llama 4 Scout' },
                    'meta-llama/llama-4-maverick-17b-128e-instruct': { en: '🚀 Llama 4 Maverick', ru: '🚀 Llama 4 Maverick' },
                    'qwen/qwen3-32b': { en: '🐉 Qwen3 32B', ru: '🐉 Qwen3 32B' },
                    'openai/gpt-oss-120b': { en: '🧠 GPT-OSS 120B', ru: '🧠 GPT-OSS 120B' },
                    'openai/gpt-oss-20b': { en: '💡 GPT-OSS 20B', ru: '💡 GPT-OSS 20B' },
                    'moonshotai/kimi-k2-instruct': { en: '🌙 Kimi K2', ru: '🌙 Kimi K2' },
                };

                const name = modelNames[selectedModel]?.[lang === 'ru' ? 'ru' : 'en'] || selectedModel;
                const msg = lang === 'ru'
                    ? `✅ Модель переключена на <b>${name}</b>\n\n<i>Просто напишите любой вопрос!</i>`
                    : `✅ Switched to <b>${name}</b>\n\n<i>Just type any question!</i>`;

                return ctx.reply(msg, { parse_mode: 'HTML' });
            }

            await ctx.answerCallbackQuery();
        });
    }

    // ── SmartMix Menu ──

    private async handleSmartMixMenu(ctx: any, lang: string) {
        const currentTier = ((ctx.session as any).mixTier as SmartMixTier) || 'free';
        const currentInfo = SMARTMIX_TIERS[currentTier];

        const sm = SMARTMIX_TIERS;
        const msg = lang === 'ru'
            ? `🧠 <b>Коллективный Интеллект</b>\n\n` +
            `Выберите уровень:\n\n` +
            `🆓 <b>Один эксперт</b> — 1 модель, бесплатно\n` +
            `🔬 <b>Совет из 3</b> — ${sm.standard.cost.toFixed(1)} GSTD ($${sm.standard.costUsd}) — 3 эксперта + консенсус\n` +
            `🔥 <b>Панель из 5</b> — ${sm.pro.cost.toFixed(1)} GSTD ($${sm.pro.costUsd}) — 5 экспертов + синтез\n` +
            `🧠 <b>Рой из 7</b> — ${sm.ultra.cost.toFixed(1)} GSTD ($${sm.ultra.costUsd}) — 7 экспертов + полная верификация\n\n` +
            `Текущий: ${currentInfo.emoji} <b>${currentInfo.nameRU}</b>`
            : `🧠 <b>Collective Intelligence</b>\n\n` +
            `Choose your level:\n\n` +
            `🆓 <b>Single Expert</b> — 1 model, free\n` +
            `🔬 <b>Council of 3</b> — ${sm.standard.cost.toFixed(1)} GSTD ($${sm.standard.costUsd}) — 3 experts + consensus\n` +
            `🔥 <b>Panel of 5</b> — ${sm.pro.cost.toFixed(1)} GSTD ($${sm.pro.costUsd}) — 5 experts + synthesis\n` +
            `🧠 <b>Swarm of 7</b> — ${sm.ultra.cost.toFixed(1)} GSTD ($${sm.ultra.costUsd}) — 7 experts + full verification\n\n` +
            `Current: ${currentInfo.emoji} <b>${currentInfo.name}</b>`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: `🆓 Free${currentTier === 'free' ? ' ✓' : ''}`, callback_data: 'smartmix_free' },
                    { text: `🔬 Council${currentTier === 'standard' ? ' ✓' : ''} ($${sm.standard.costUsd})`, callback_data: 'smartmix_standard' },
                ],
                [
                    { text: `🔥 Panel${currentTier === 'pro' ? ' ✓' : ''} ($${sm.pro.costUsd})`, callback_data: 'smartmix_pro' },
                    { text: `🧠 Swarm${currentTier === 'ultra' ? ' ✓' : ''} ($${sm.ultra.costUsd})`, callback_data: 'smartmix_ultra' },
                ],
            ],
        };

        return ctx.reply(msg, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    // ── Button handlers ──

    /** Handle deep link from monitor: sponsor-{signalId}-{starsCost} */
    private async handleSponsorDeepLink(ctx: any, lang: string, signalId: string, starsCost: number) {
        console.log(`[Sponsor] Processing deep link: signal=${signalId} stars=${starsCost}`);

        const STAR_USD = 0.013;
        let gstdPrice = 0;
        try {
            const priceData = await this.apiCall('/api/v1/market/price');
            gstdPrice = priceData.gstd_price_usd || 0;
        } catch { }
        const gstdPerStar = gstdPrice > 0 ? STAR_USD / gstdPrice : 10;
        const gstdReward = Math.floor(starsCost * gstdPerStar * 0.85); // 85% to workers
        const platformFee = Math.floor(starsCost * gstdPerStar * 0.15); // 15% platform
        const usd = (starsCost * STAR_USD).toFixed(2);

        // Format signal ID for display
        const signalName = signalId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        const title = lang === 'ru'
            ? `🌍 Сигнал: ${signalName}`
            : `🌍 Signal: ${signalName}`;
        const desc = lang === 'ru'
            ? `${starsCost}⭐ ($${usd}) → ${gstdReward} GSTD рабочим роя + ${platformFee} GSTD фонд. Результаты → Коллективная Память.`
            : `${starsCost}⭐ ($${usd}) → ${gstdReward} GSTD to Swarm workers + ${platformFee} GSTD fund. Results → Collective Memory.`;

        // Show info message first
        const infoMsg = lang === 'ru'
            ? `🌍 <b>Спонсирование сигнала</b>\n\n` +
            `📡 <b>${signalName}</b>\n` +
            `⭐ Стоимость: <b>${starsCost} Stars</b> ($${usd})\n` +
            `💰 Награда Рою: <b>${gstdReward} GSTD</b>\n` +
            `🏗 Фонд развития: <b>${platformFee} GSTD</b>\n\n` +
            `<i>Оплатите инвойс ниже для запуска анализа 👇</i>`
            : `🌍 <b>Signal Sponsorship</b>\n\n` +
            `📡 <b>${signalName}</b>\n` +
            `⭐ Cost: <b>${starsCost} Stars</b> ($${usd})\n` +
            `💰 Swarm Reward: <b>${gstdReward} GSTD</b>\n` +
            `🏗 Development Fund: <b>${platformFee} GSTD</b>\n\n` +
            `<i>Pay the invoice below to launch analysis 👇</i>`;

        await ctx.reply(infoMsg, { parse_mode: 'HTML' });

        // Record sponsorship intent in backend
        try {
            await this.apiCall(`/api/v1/monitor/signals/${signalId}/sponsor`, {
                method: 'POST',
                body: {
                    user_id: `tg_${ctx.from.id}`,
                    telegram_id: ctx.from.id,
                    stars_paid: starsCost,
                    gstd_reward: gstdReward,
                    gstd_gold_fee: platformFee,
                },
            });
        } catch (err: any) {
            console.warn('[Sponsor] Backend record failed (non-fatal):', err.message);
        }

        // Send Stars invoice
        try {
            await ctx.api.sendInvoice(
                ctx.chat!.id,
                title,
                desc,
                `gstd_sponsor_${signalId}_${ctx.from.id}_${Date.now()}`,
                'XTR',
                [{ label: title, amount: starsCost }],
            );
            console.log(`[Sponsor] ✅ Invoice sent for ${signalId} (${starsCost}⭐)`);
        } catch (err: any) {
            console.error('[Sponsor] ❌ Invoice error:', err.message);
            const errMsg = lang === 'ru'
                ? '❌ Ошибка создания счёта. Попробуйте через ⭐️ Пополнить.'
                : '❌ Error creating invoice. Try via ⭐️ Top Up.';
            await ctx.reply(errMsg);
        }
    }

    private async handleBalance(ctx: any, lang: string) {
        try {
            const data = await this.apiCall(`/api/v1/telegram/bot/balance?telegram_id=${ctx.from.id}`);

            const costPerPro = SMARTMIX_TIERS.standard.cost;
            const proReqs = costPerPro > 0 ? Math.floor((data.balance_gstd || 0) / costPerPro) : 999;
            const pending = data.pending_gstd || 0;

            let msg: string;
            if (lang === 'ru') {
                msg = `💎 <b>Мой Баланс</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro запросов: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Награда: ${pending.toFixed(4)} GSTD</b>\n   └ После комиссии: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Фонд развития, 5% → Sovereign AI Pool`;
                }
                msg += `\n\n<i>🆓 Бесплатная модель всегда доступна\n⚡ Pro = ${costPerPro.toFixed(1)} GSTD/запрос ($${SMARTMIX_TIERS.standard.costUsd})</i>`;
            } else {
                msg = `💎 <b>My Balance</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro requests: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Mining reward: ${pending.toFixed(4)} GSTD</b>\n   └ After commission: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Development Fund, 5% → Sovereign AI Pool`;
                }
                msg += `\n\n<i>🆓 Free model always available\n⚡ Pro = ${costPerPro.toFixed(1)} GSTD/request ($${SMARTMIX_TIERS.standard.costUsd})</i>`;
            }

            const inlineKeyboard: any[][] = [];
            if (pending >= 0.01) {
                inlineKeyboard.push([{ text: lang === 'ru' ? '🎁 Забрать награду' : '🎁 Claim Reward', callback_data: 'claim_reward' }]);
            }

            await ctx.reply(msg, {
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined,
            });
        } catch {
            await ctx.reply(lang === 'ru' ? '❌ Ошибка загрузки баланса' : '❌ Error loading balance');
        }
    }

    private async handleTopUp(ctx: any, lang: string) {
        // Fetch real GSTD price for accurate rate
        const STAR_USD = 0.013; // 1 Telegram Star ≈ $0.013
        let gstdPrice = 0;
        try {
            const priceData = await this.apiCall('/api/v1/market/price');
            gstdPrice = priceData.gstd_price_usd || 0;
        } catch { }

        const gstdPerStar = gstdPrice > 0 ? STAR_USD / gstdPrice : 10;

        // Check wallet status
        let walletStatus = '';
        let hasWallet = false;
        try {
            const walletData = await this.apiCall(`/api/v1/telegram/bot/wallet?telegram_id=${ctx.from.id}`);
            if (walletData.linked && walletData.wallet) {
                hasWallet = true;
                const shortWallet = walletData.wallet.slice(0, 6) + '...' + walletData.wallet.slice(-4);
                walletStatus = lang === 'ru'
                    ? `💼 <b>Кошелёк:</b> ${shortWallet} ✅`
                    : `💼 <b>Wallet:</b> ${shortWallet} ✅`;
            } else {
                walletStatus = lang === 'ru'
                    ? `💼 <b>Кошелёк:</b> не привязан (будет внутренний баланс)\n⚠️ <i>Привяжите кошелёк кнопкой 🔗 Кошелек, чтобы получать GSTD на свой адрес</i>`
                    : `💼 <b>Wallet:</b> not linked (will use internal balance)\n⚠️ <i>Link wallet via 🔗 Wallet button to receive GSTD to your address</i>`;
            }
        } catch {
            walletStatus = lang === 'ru'
                ? `💼 <b>Кошелёк:</b> не определён`
                : `💼 <b>Wallet:</b> unknown`;
        }

        // Tiers
        const tiers = [
            { stars: 10, label: 'Starter' },
            { stars: 50, label: 'Pro' },
            { stars: 200, label: 'Ultra' },
        ];

        const tierLines = tiers.map(t => {
            const gstd = Math.floor(t.stars * gstdPerStar);
            const proReqs = Math.floor(gstd / (SMARTMIX_TIERS.standard.cost || 3.4));
            const usd = (t.stars * STAR_USD).toFixed(2);
            return lang === 'ru'
                ? `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`
                : `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`;
        });

        // Commission/TON info
        const commissionNote = lang === 'ru'
            ? `\n\n📌 <b>Важно:</b>\n• GSTD зачисляются мгновенно на привязанный кошелёк\n• Для вывода GSTD на TON-кошелёк требуется ~0.05 TON на комиссию сети\n• Без привязки кошелька — GSTD хранятся на внутреннем балансе`
            : `\n\n📌 <b>Important:</b>\n• GSTD is credited instantly to your linked wallet\n• Withdrawing GSTD to TON wallet requires ~0.05 TON for network fees\n• Without linked wallet — GSTD is stored on internal balance`;

        const msg = lang === 'ru'
            ? `⭐️ <b>Пополнить GSTD через Stars</b>\n\n` +
            `${walletStatus}\n\n` +
            `📊 <b>Курс:</b> 1⭐ = ${gstdPerStar.toFixed(0)} GSTD ($${STAR_USD})\n` +
            `📊 GSTD = $${gstdPrice > 0 ? gstdPrice.toFixed(6) : '~0.0002'}\n\n` +
            tierLines.join('\n') + '\n\n' +
            `💡 <i>GSTD Pro: $0.005/запрос — от $0.50 за 100 запросов!</i>` +
            commissionNote
            : `⭐️ <b>Top Up GSTD via Stars</b>\n\n` +
            `${walletStatus}\n\n` +
            `📊 <b>Rate:</b> 1⭐ = ${gstdPerStar.toFixed(0)} GSTD ($${STAR_USD})\n` +
            `📊 GSTD = $${gstdPrice > 0 ? gstdPrice.toFixed(6) : '~0.0002'}\n\n` +
            tierLines.join('\n') + '\n\n' +
            `💡 <i>GSTD Pro: $0.005/request — from $0.50 per 100 requests!</i>` +
            commissionNote;

        const buttons = tiers.map(t => {
            const gstd = Math.floor(t.stars * gstdPerStar);
            return { text: `${t.stars}⭐ → ${gstd} GSTD`, callback_data: `buy_${t.stars}` };
        });

        // Add wallet link button if not linked
        const inlineRows: any[][] = [buttons];
        if (!hasWallet) {
            inlineRows.push([{
                text: lang === 'ru' ? '🔗 Привязать кошелёк' : '🔗 Link Wallet',
                callback_data: 'link_wallet_prompt',
            }]);
        }

        await ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineRows },
        });
    }

    private async handleWallet(ctx: any, lang: string) {
        // Check if wallet is already linked
        try {
            const walletData = await this.apiCall(`/api/v1/telegram/bot/wallet?telegram_id=${ctx.from.id}`);
            if (walletData.linked && walletData.wallet) {
                const shortWallet = walletData.wallet.slice(0, 6) + '...' + walletData.wallet.slice(-4);
                const msg = lang === 'ru'
                    ? `🔗 <b>Ваш кошелёк</b>\n\n✅ Привязан: <code>${walletData.wallet}</code>\n📋 ${shortWallet}\n\n💡 Чтобы сменить кошелёк, отправьте новый адрес TON-кошелька в чат.\n\nНапример: <code>EQDv...</code>`
                    : `🔗 <b>Your Wallet</b>\n\n✅ Linked: <code>${walletData.wallet}</code>\n📋 ${shortWallet}\n\n💡 To change wallet, send a new TON wallet address in the chat.\n\nExample: <code>EQDv...</code>`;
                return ctx.reply(msg, { parse_mode: 'HTML' });
            }
        } catch { }

        const msg = lang === 'ru'
            ? `🔗 <b>Привязка кошелька</b>\n\n⚠️ Кошелёк не привязан.\n\nОтправьте адрес вашего TON-кошелька прямо в чат.\n\nНапример: <code>EQDv...</code>\n\n❓ Нет кошелька?\n• <a href="https://tonkeeper.com">Tonkeeper</a>\n• <a href="https://mytonwallet.io">MyTonWallet</a>\n\n💡 <i>После привязки кошелька все купленные GSTD будут зачисляться на него.</i>`
            : `🔗 <b>Connect Wallet</b>\n\n⚠️ No wallet linked.\n\nSend your TON wallet address in the chat.\n\nExample: <code>EQDv...</code>\n\n❓ No wallet?\n• <a href="https://tonkeeper.com">Tonkeeper</a>\n• <a href="https://mytonwallet.io">MyTonWallet</a>\n\n💡 <i>After linking, all purchased GSTD will be credited to your wallet.</i>`;
        await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }

    private async handleLinkWallet(ctx: any, lang: string, walletAddress: string) {
        try {
            const result = await this.apiCall('/api/v1/telegram/bot/link', {
                method: 'POST',
                body: {
                    telegram_id: ctx.from.id,
                    wallet_address: walletAddress,
                    username: ctx.from.username || '',
                    first_name: ctx.from.first_name || '',
                },
            });
            const shortWallet = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
            let msg: string;
            if (lang === 'ru') {
                msg = `✅ <b>Кошелёк привязан!</b>\n\n📋 ${shortWallet}\n<code>${walletAddress}</code>\n\n💰 Все купленные GSTD будут зачисляться на этот кошелёк.`;
                if (result.subsidized) {
                    msg += '\n\n🎁 <b>Бонус:</b> Немного TON отправлено на ваш кошелёк для первых транзакций!';
                }
            } else {
                msg = `✅ <b>Wallet Linked!</b>\n\n📋 ${shortWallet}\n<code>${walletAddress}</code>\n\n💰 All purchased GSTD will be credited to this wallet.`;
                if (result.subsidized) {
                    msg += '\n\n🎁 <b>Bonus:</b> Some TON sent to your wallet for first transactions!';
                }
            }
            await ctx.reply(msg, { parse_mode: 'HTML' });
        } catch (err: any) {
            console.error('[Bot] Link wallet error:', err.message);
            const errMsg = lang === 'ru'
                ? '❌ Ошибка привязки кошелька. Проверьте адрес и попробуйте снова.'
                : '❌ Failed to link wallet. Check the address and try again.';
            await ctx.reply(errMsg);
        }
    }

    private async handleEarn(ctx: any, lang: string) {
        const msg = lang === 'ru'
            ? `🧠 <b>Заработать GSTD</b>\n\nСтаньте частью роя:\n\n🌐 Откройте <a href="https://app.gstdtoken.com">приложение</a>\n⚡ Включите Нейро-Узел\n💰 Получайте GSTD за вычисления\n🎁 Забирайте награды кнопкой 💎 Баланс\n\n<i>Комиссия: 10% → Фонд развития, 5% → Sovereign AI Pool</i>`
            : `🧠 <b>Earn GSTD</b>\n\nJoin the Swarm:\n\n🌐 Open the <a href="https://app.gstdtoken.com">app</a>\n⚡ Turn on Neural Node\n💰 Earn GSTD for computing\n🎁 Claim rewards via 💎 Balance\n\n<i>Commission: 10% → Development Fund, 5% → Sovereign AI Pool</i>`;
        await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }

    private async sendHelp(ctx: any) {
        const lang = this.lang(ctx);
        const isPrivate = ctx.chat?.type === 'private';

        if (isPrivate) {
            const msg = lang === 'ru'
                ? `📖 <b>Помощь</b>\n\n` +
                `🆓 <b>Бесплатный ИИ</b> — просто пиши, всегда доступен (Kimi K2 · LLaMA4 · GPT-OSS-120B)\n` +
                `⚡ <b>Sovereign Pro</b> — 0.1 GSTD/запрос, лучшие модели роя\n\n` +
                `<b>Кнопки:</b>\n` +
                `💎 Баланс — проверить GSTD + забрать награды\n` +
                `⭐️ Пополнить — купить GSTD за Stars\n` +
                `🔗 Кошелек — привязать TON кошелек\n` +
                `🧠 Заработать — включить майнинг\n` +
                `📱 Приложение — открыть дашборд\n\n` +
                `<i>Лучшая цена за Pro-качество!</i>`
                : `📖 <b>Help</b>\n\n` +
                `🆓 <b>Free AI</b> — just type, always available (Kimi K2 · LLaMA4 · GPT-OSS-120B)\n` +
                `⚡ <b>Sovereign Pro</b> — 0.1 GSTD/request, best swarm models\n\n` +
                `<b>Buttons:</b>\n` +
                `💎 Balance — check GSTD + claim rewards\n` +
                `⭐️ Top Up — buy GSTD via Stars\n` +
                `🔗 Wallet — connect TON wallet\n` +
                `🧠 Earn — start mining\n` +
                `📱 App — open dashboard\n\n` +
                `<i>Best price for Pro-quality AI!</i>`;
            await ctx.reply(msg, { parse_mode: 'HTML' });
        } else {
            await ctx.reply(
                `🐝 <b>GSTD Bot</b>\n\nTag @${this.bot.botInfo?.username} to ask me anything!`,
                { parse_mode: 'HTML' }
            );
        }
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

    // ─── Markdown → Telegram HTML converter (ChatGPT/Claude level formatting) ──
    private markdownToTelegramHtml(text: string): string {
        let result = text;

        // Escape HTML entities first (except in code blocks)
        // We'll handle code blocks separately
        const codeBlocks: string[] = [];

        // Extract fenced code blocks ```lang\n...\n```
        result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
            const idx = codeBlocks.length;
            const langAttr = lang ? ` class="language-${lang}"` : '';
            codeBlocks.push(`<pre><code${langAttr}>${this.escapeHtml(code.trimEnd())}</code></pre>`);
            return `__CODEBLOCK_${idx}__`;
        });

        // Extract inline code `...`
        result = result.replace(/`([^`]+)`/g, (_match, code) => {
            return `<code>${this.escapeHtml(code)}</code>`;
        });

        // Now escape remaining HTML
        result = result.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // But un-escape our HTML tags
        result = result.replace(/&lt;(\/?(b|i|u|s|code|pre|a|blockquote)[^&]*?)&gt;/g, '<$1>');

        // Bold: **text** or __text__
        result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        result = result.replace(/__(.+?)__/g, '<b>$1</b>');

        // Italic: *text* (but not inside bold)
        result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

        // Headers: # → bold
        result = result.replace(/^#{1,6}\s+(.+)$/gm, '\n<b>$1</b>');

        // Horizontal rules
        result = result.replace(/^---+$/gm, '─────────────────');

        // Lists: - item → • item
        result = result.replace(/^[-*]\s+/gm, '• ');

        // Numbered lists keep as is

        // Restore code blocks
        for (let i = 0; i < codeBlocks.length; i++) {
            result = result.replace(`__CODEBLOCK_${i}__`, codeBlocks[i]);
        }

        // Clean up multiple blank lines
        result = result.replace(/\n{3,}/g, '\n\n');

        return result.trim();
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Send formatted reply, splitting into chunks if needed
    private async sendFormattedReply(ctx: any, html: string, isGroup: boolean): Promise<void> {
        const MAX_LEN = 4000;

        if (html.length <= MAX_LEN) {
            await ctx.reply(html, {
                parse_mode: 'HTML',
                reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
            });
            return;
        }

        // Split into chunks at paragraph boundaries
        const paragraphs = html.split('\n\n');
        let chunk = '';
        for (const p of paragraphs) {
            if ((chunk + '\n\n' + p).length > MAX_LEN && chunk) {
                await ctx.reply(chunk.trim(), {
                    parse_mode: 'HTML',
                    reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                });
                chunk = p;
            } else {
                chunk = chunk ? chunk + '\n\n' + p : p;
            }
        }
        if (chunk.trim()) {
            await ctx.reply(chunk.trim(), {
                parse_mode: 'HTML',
                reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
            });
        }
    }
}
