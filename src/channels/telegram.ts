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
                    [{ text: '📱 Приложение' }, { text: '📖 Помощь' }],
                ],
                resize_keyboard: true,
                is_persistent: true,
            };
        }
        return {
            keyboard: [
                [{ text: '💎 Balance' }, { text: '⭐️ Top Up' }],
                [{ text: '🔗 Wallet' }, { text: '🧠 Earn' }],
                [{ text: '📱 App' }, { text: '📖 Help' }],
            ],
            resize_keyboard: true,
            is_persistent: true,
        };
    }

    private setupHandlers(): void {
        // ── /start — Welcome + keyboard ──
        this.bot.command('start', async (ctx) => {
            if (ctx.chat?.type !== 'private') return;
            ctx.session.history = [];
            ctx.session.model = 'auto';
            const lang = this.lang(ctx);

            const msg = lang === 'ru'
                ? `🐝 <b>GSTD — Суверенный ИИ</b>\n\n` +
                `🆓 <b>Бесплатно навсегда:</b> просто пиши — ИИ ответит. Коллективная Память роя.\n\n` +
                `⚡ <b>Cocoon Pro:</b> GSTD активирует лучшие модели + обучаемый ИИ.\n` +
                `Стоимость: 0.1 GSTD/запрос ($0.005)\n` +
                `ChatGPT Plus = $20/мес. GSTD Pro = $0.50/100 запросов — <b>40× дешевле!</b>\n\n` +
                `💡 <i>Переключение автоматическое — есть GSTD = Pro, нет = базовая модель</i>`
                : `🐝 <b>GSTD — Sovereign AI</b>\n\n` +
                `🆓 <b>Free forever:</b> just type — AI responds. Collective Memory of the Swarm.\n\n` +
                `⚡ <b>Cocoon Pro:</b> GSTD unlocks best models + learning AI.\n` +
                `Cost: 0.1 GSTD/request ($0.005)\n` +
                `ChatGPT Plus = $20/mo. GSTD Pro = $0.50/100 requests — <b>40× cheaper!</b>\n\n` +
                `💡 <i>Auto-switch: have GSTD = Pro, don't = free model</i>`;

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
                if (text === '⭐️ Top Up' || text === '⭐️ Пополнить') {
                    return this.handleTopUp(ctx, lang);
                }
                // 📖 Help
                if (text === '📖 Help' || text === '📖 Помощь') {
                    return this.sendHelp(ctx);
                }
                // 🔗 Wallet
                if (text === '🔗 Wallet' || text === '🔗 Кошелек') {
                    return this.handleWallet(ctx, lang);
                }
                // 🧠 Earn
                if (text === '🧠 Earn' || text === '🧠 Заработать') {
                    return this.handleEarn(ctx, lang);
                }
                // 📱 App
                if (text === '📱 App' || text === '📱 Приложение') {
                    const msg = lang === 'ru'
                        ? '📱 <b>Откройте приложение:</b>\n\nhttps://app.gstdtoken.com'
                        : '📱 <b>Open the app:</b>\n\nhttps://app.gstdtoken.com';
                    return ctx.reply(msg, { parse_mode: 'HTML' });
                }
            }

            // ── AI Chat ──
            const cleanMessage = text.replace(new RegExp(`@${this.bot.botInfo?.username}`, 'gi'), '').trim();
            if (!cleanMessage) return;

            console.log(`[AI] Processing: "${cleanMessage.substring(0, 40)}"`);
            await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

            const systemPrompt = isGroup
                ? 'You are GSTD Bot in a community group chat. Be helpful and concise. Respond in the user\'s language. Keep answers under 200 words.'
                : 'You are GSTD — a sovereign decentralized AI powered by the Swarm. You have Collective Memory from all users. Respond in the user\'s language. Be helpful, concise, and direct.';

            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                { role: 'system', content: systemPrompt },
                ...(isPrivate ? ctx.session.history.slice(-20) : []),
                { role: 'user', content: cleanMessage },
            ];

            try {
                console.log('[AI] Calling router.route...');
                const result = await this.router.route(ctx.session.model || 'auto', messages);
                console.log(`[AI] Got response: ${result.tier} ${result.model} ${result.latencyMs}ms len=${result.content.length}`);

                if (isPrivate) {
                    ctx.session.history.push({ role: 'user', content: cleanMessage });
                    ctx.session.history.push({ role: 'assistant', content: result.content });
                    if (ctx.session.history.length > 40) {
                        ctx.session.history = ctx.session.history.slice(-30);
                    }
                }

                const tierLabel = result.tier === 'cache' ? '⚡' : '🆓';
                const footer = isPrivate
                    ? `\n\n${tierLabel} Collective Memory · ${result.latencyMs}ms`
                    : '';

                const fullResponse = result.content + footer;

                // Send as plain text to avoid Markdown parsing errors
                try {
                    await ctx.reply(fullResponse, {
                        reply_to_message_id: isGroup ? ctx.message?.message_id : undefined,
                    });
                    console.log('[AI] ✅ Reply sent successfully');
                } catch (sendErr: any) {
                    console.error('[AI] ❌ Send error:', sendErr.message, sendErr.description);
                    // Truncate if too long
                    try {
                        await ctx.reply(fullResponse.substring(0, 4000));
                        console.log('[AI] ✅ Truncated reply sent');
                    } catch (e2: any) {
                        console.error('[AI] ❌❌ Even truncated failed:', e2.message);
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
                        ? `✅ <b>Награда получена!</b>\n\n💰 Зачислено: <b>${result.claimed_net.toFixed(4)} GSTD</b>\n🏆 Золотой Резерв: <b>${result.gold_reserve.toFixed(4)} GSTD</b> (10%)\n🔥 Сожжено: <b>${result.burned.toFixed(4)} GSTD</b> (5%)`
                        : `✅ <b>Reward Claimed!</b>\n\n💰 Received: <b>${result.claimed_net.toFixed(4)} GSTD</b>\n🏆 Gold Reserve: <b>${result.gold_reserve.toFixed(4)} GSTD</b> (10%)\n🔥 Burned: <b>${result.burned.toFixed(4)} GSTD</b> (5%)`;
                    return ctx.reply(msg, { parse_mode: 'HTML' });
                } catch {
                    return ctx.reply('❌ Error claiming');
                }
            }

            if (data === 'buy_stars') {
                await ctx.answerCallbackQuery();
                return this.handleTopUp(ctx, lang);
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
                const proReqs = Math.floor(gstdAmount / 0.1);
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

            await ctx.answerCallbackQuery();
        });
    }

    // ── Button handlers ──

    private async handleBalance(ctx: any, lang: string) {
        try {
            const data = await this.apiCall(`/api/v1/telegram/bot/balance?telegram_id=${ctx.from.id}`);

            const proReqs = Math.floor((data.balance_gstd || 0) / 0.1);
            const pending = data.pending_gstd || 0;

            let msg: string;
            if (lang === 'ru') {
                msg = `💎 <b>Мой Баланс</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro запросов: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Награда: ${pending.toFixed(4)} GSTD</b>\n   └ После комиссии: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Золотой Резерв, 5% → Сжигание`;
                }
                msg += '\n\n<i>🆓 Бесплатная модель всегда доступна\n⚡ Pro = 0.1 GSTD/запрос ($0.005)</i>';
            } else {
                msg = `💎 <b>My Balance</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro requests: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Mining reward: ${pending.toFixed(4)} GSTD</b>\n   └ After commission: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Gold Reserve, 5% → Burn`;
                }
                msg += '\n\n<i>🆓 Free model always available\n⚡ Pro = 0.1 GSTD/request ($0.005)</i>';
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

        // Tiers
        const tiers = [
            { stars: 10, label: 'Starter' },
            { stars: 50, label: 'Pro' },
            { stars: 200, label: 'Ultra' },
        ];

        const tierLines = tiers.map(t => {
            const gstd = Math.floor(t.stars * gstdPerStar);
            const proReqs = Math.floor(gstd / 0.1);
            const usd = (t.stars * STAR_USD).toFixed(2);
            return lang === 'ru'
                ? `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`
                : `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`;
        });

        // ChatGPT comparison
        const chatgptReqs = Math.floor(20 / 0.005); // $20 / $0.005 per req
        const ourReqsFor20 = Math.floor((20 / (gstdPrice > 0 ? gstdPrice : 0.0002)) / 10); // simplified

        const msg = lang === 'ru'
            ? `⭐️ <b>Пополнить GSTD через Stars</b>\n\n` +
            `📊 <b>Курс:</b> 1⭐ = ${gstdPerStar.toFixed(0)} GSTD ($${STAR_USD})\n` +
            `📊 GSTD = $${gstdPrice > 0 ? gstdPrice.toFixed(6) : '~0.0002'}\n\n` +
            tierLines.join('\n') + '\n\n' +
            `💡 <i>ChatGPT Plus = $20/мес ≈ ${chatgptReqs} запросов\n` +
            `GSTD Pro: $0.005/запрос — в ${Math.floor(20 / (50 * STAR_USD))}× дешевле!</i>\n\n` +
            `Отправьте /buy_stars [кол-во] или нажмите:`
            : `⭐️ <b>Top Up GSTD via Stars</b>\n\n` +
            `📊 <b>Rate:</b> 1⭐ = ${gstdPerStar.toFixed(0)} GSTD ($${STAR_USD})\n` +
            `📊 GSTD = $${gstdPrice > 0 ? gstdPrice.toFixed(6) : '~0.0002'}\n\n` +
            tierLines.join('\n') + '\n\n' +
            `💡 <i>ChatGPT Plus = $20/mo ≈ ${chatgptReqs} requests\n` +
            `GSTD Pro: $0.005/request — ${Math.floor(20 / (50 * STAR_USD))}× cheaper!</i>\n\n` +
            `Send /buy_stars [amount] or tap:`;

        const buttons = tiers.map(t => {
            const gstd = Math.floor(t.stars * gstdPerStar);
            return { text: `${t.stars}⭐ → ${gstd} GSTD`, callback_data: `buy_${t.stars}` };
        });

        await ctx.reply(msg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [buttons] },
        });
    }

    private async handleWallet(ctx: any, lang: string) {
        const msg = lang === 'ru'
            ? `🔗 <b>Привязка кошелька</b>\n\nОтправьте адрес вашего TON-кошелька прямо в чат.\n\nНапример: <code>EQDv...</code>\n\nНет кошелька?\n• <a href="https://tonkeeper.com">Tonkeeper</a>\n• <a href="https://mytonwallet.io">MyTonWallet</a>`
            : `🔗 <b>Connect Wallet</b>\n\nSend your TON wallet address in the chat.\n\nExample: <code>EQDv...</code>\n\nNo wallet?\n• <a href="https://tonkeeper.com">Tonkeeper</a>\n• <a href="https://mytonwallet.io">MyTonWallet</a>`;
        await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }

    private async handleEarn(ctx: any, lang: string) {
        const msg = lang === 'ru'
            ? `🧠 <b>Заработать GSTD</b>\n\nСтаньте частью роя:\n\n🌐 Откройте <a href="https://app.gstdtoken.com">приложение</a>\n⚡ Включите Нейро-Узел\n💰 Получайте GSTD за вычисления\n🎁 Забирайте награды кнопкой 💎 Баланс\n\n<i>Комиссия: 10% → Золотой Резерв, 5% → Сжигание</i>`
            : `🧠 <b>Earn GSTD</b>\n\nJoin the Swarm:\n\n🌐 Open the <a href="https://app.gstdtoken.com">app</a>\n⚡ Turn on Neural Node\n💰 Earn GSTD for computing\n🎁 Claim rewards via 💎 Balance\n\n<i>Commission: 10% → Gold Reserve, 5% → Burn</i>`;
        await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }

    private async sendHelp(ctx: any) {
        const lang = this.lang(ctx);
        const isPrivate = ctx.chat?.type === 'private';

        if (isPrivate) {
            const msg = lang === 'ru'
                ? `📖 <b>Помощь</b>\n\n` +
                `🆓 <b>Бесплатный ИИ</b> — просто пиши, всегда доступен\n` +
                `⚡ <b>Cocoon Pro</b> — 0.1 GSTD/запрос, лучшие модели\n\n` +
                `<b>Кнопки:</b>\n` +
                `💎 Баланс — проверить GSTD + забрать награды\n` +
                `⭐️ Пополнить — купить GSTD за Stars\n` +
                `🔗 Кошелек — привязать TON кошелек\n` +
                `🧠 Заработать — включить майнинг\n` +
                `📱 Приложение — открыть дашборд\n\n` +
                `<i>40× дешевле ChatGPT Plus!</i>`
                : `📖 <b>Help</b>\n\n` +
                `🆓 <b>Free AI</b> — just type, always available\n` +
                `⚡ <b>Cocoon Pro</b> — 0.1 GSTD/request, best models\n\n` +
                `<b>Buttons:</b>\n` +
                `💎 Balance — check GSTD + claim rewards\n` +
                `⭐️ Top Up — buy GSTD via Stars\n` +
                `🔗 Wallet — connect TON wallet\n` +
                `🧠 Earn — start mining\n` +
                `📱 App — open dashboard\n\n` +
                `<i>40× cheaper than ChatGPT Plus!</i>`;
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
}
