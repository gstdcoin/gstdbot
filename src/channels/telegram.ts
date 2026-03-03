/**
 * Telegram Channel — grammY-based Telegram bot integration
 * + Community Guardian for group chats
 */

import { Bot, Context, session } from 'grammy';
import { NeuralRouter, type SmartMixTier, SMARTMIX_TIERS } from '../gateway/router.js';
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
                    [{ text: '🔬 SmartMix' }, { text: '📖 Помощь' }],
                ],
                resize_keyboard: true,
                is_persistent: true,
            };
        }
        return {
            keyboard: [
                [{ text: '💎 Balance' }, { text: '⭐️ Top Up' }],
                [{ text: '🔗 Wallet' }, { text: '🧠 Earn' }],
                [{ text: '🔬 SmartMix' }, { text: '📖 Help' }],
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
                // 🔬 SmartMix
                if (text === '🔬 SmartMix') {
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

            const systemPrompt = isGroup
                ? 'You are GSTD Bot in a community group chat. Be helpful and concise. Respond in the user\'s language. Keep answers under 200 words.'
                : 'You are GSTD — a sovereign decentralized AI powered by the Swarm. You have Collective Memory from all users. Respond in the user\'s language. Be helpful, concise, and direct.';

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

            // SmartMix tier selection callbacks
            if (data.startsWith('smartmix_')) {
                await ctx.answerCallbackQuery();
                const selectedTier = data.replace('smartmix_', '') as SmartMixTier;
                (ctx.session as any).mixTier = selectedTier;

                const tierInfo = SMARTMIX_TIERS[selectedTier] || SMARTMIX_TIERS.free;
                const msg = lang === 'ru'
                    ? `${tierInfo.emoji} <b>${tierInfo.nameRU}</b> активирован!\n\n` +
                    `${tierInfo.cost > 0 ? `💰 Стоимость: ${tierInfo.cost} GSTD/запрос` : '🆓 Бесплатно'}\n\n` +
                    `<i>Пишите любой вопрос — я отвечу с использованием ${selectedTier === 'ultra' ? '3 моделей ИИ + синтез' : selectedTier === 'pro' ? '2 моделей + синтез' : selectedTier === 'standard' ? 'лучшей модели' : 'базовой модели'}.</i>`
                    : `${tierInfo.emoji} <b>${tierInfo.name}</b> activated!\n\n` +
                    `${tierInfo.cost > 0 ? `💰 Cost: ${tierInfo.cost} GSTD/request` : '🆓 Free'}\n\n` +
                    `<i>Type any question — I'll answer using ${selectedTier === 'ultra' ? '3 AI models + consensus' : selectedTier === 'pro' ? '2 models + synthesis' : selectedTier === 'standard' ? 'best available model' : 'fast single model'}.</i>`;

                return ctx.reply(msg, { parse_mode: 'HTML' });
            }

            await ctx.answerCallbackQuery();
        });
    }

    // ── SmartMix Menu ──

    private async handleSmartMixMenu(ctx: any, lang: string) {
        const currentTier = ((ctx.session as any).mixTier as SmartMixTier) || 'free';
        const currentInfo = SMARTMIX_TIERS[currentTier];

        const msg = lang === 'ru'
            ? `🔬 <b>SmartMix — Смесь Моделей</b>\n\n` +
            `Выберите тир для ваших запросов:\n\n` +
            `🆓 <b>Free</b> — одна быстрая модель (llama-3.3-70b)\n` +
            `⚡ <b>Standard</b> — 0.01 GSTD — умный выбор лучшей модели\n` +
            `🔥 <b>Pro</b> — 0.05 GSTD — 2 модели + синтез ответа\n` +
            `🧠 <b>Ultra</b> — 0.15 GSTD — 3 эксперта + консенсус\n\n` +
            `Текущий: ${currentInfo.emoji} <b>${currentInfo.nameRU}</b>`
            : `🔬 <b>SmartMix — Model Mixing</b>\n\n` +
            `Choose a tier for your queries:\n\n` +
            `🆓 <b>Free</b> — single fast model (llama-3.3-70b)\n` +
            `⚡ <b>Standard</b> — 0.01 GSTD — smart routing to best model\n` +
            `🔥 <b>Pro</b> — 0.05 GSTD — 2 models + answer synthesis\n` +
            `🧠 <b>Ultra</b> — 0.15 GSTD — 3 experts + consensus\n\n` +
            `Current: ${currentInfo.emoji} <b>${currentInfo.name}</b>`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: `🆓 Free${currentTier === 'free' ? ' ✓' : ''}`, callback_data: 'smartmix_free' },
                    { text: `⚡ Standard${currentTier === 'standard' ? ' ✓' : ''} (0.01)`, callback_data: 'smartmix_standard' },
                ],
                [
                    { text: `🔥 Pro${currentTier === 'pro' ? ' ✓' : ''} (0.05)`, callback_data: 'smartmix_pro' },
                    { text: `🧠 Ultra${currentTier === 'ultra' ? ' ✓' : ''} (0.15)`, callback_data: 'smartmix_ultra' },
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

            const proReqs = Math.floor((data.balance_gstd || 0) / 0.1);
            const pending = data.pending_gstd || 0;

            let msg: string;
            if (lang === 'ru') {
                msg = `💎 <b>Мой Баланс</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro запросов: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Награда: ${pending.toFixed(4)} GSTD</b>\n   └ После комиссии: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Фонд развития, 5% → Sovereign AI Pool`;
                }
                msg += '\n\n<i>🆓 Бесплатная модель всегда доступна\n⚡ Pro = 0.1 GSTD/запрос ($0.005)</i>';
            } else {
                msg = `💎 <b>My Balance</b>\n\n💰 <b>${(data.balance_gstd || 0).toFixed(4)} GSTD</b>\n⚡ Pro requests: <b>${proReqs}</b>`;
                if (pending > 0) {
                    msg += `\n\n⏳ <b>Mining reward: ${pending.toFixed(4)} GSTD</b>\n   └ After commission: <b>${(pending * 0.85).toFixed(4)} GSTD</b>\n   └ 10% → Development Fund, 5% → Sovereign AI Pool`;
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
            const proReqs = Math.floor(gstd / 0.1);
            const usd = (t.stars * STAR_USD).toFixed(2);
            return lang === 'ru'
                ? `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`
                : `${t.stars}⭐ = <b>${gstd} GSTD</b> = ${proReqs} Pro ($${usd})`;
        });

        // ChatGPT comparison
        const chatgptReqs = Math.floor(20 / 0.005); // $20 / $0.005 per req

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
            `💡 <i>ChatGPT Plus = $20/мес ≈ ${chatgptReqs} запросов\n` +
            `GSTD Pro: $0.005/запрос — в ${Math.floor(20 / (50 * STAR_USD))}× дешевле!</i>` +
            commissionNote
            : `⭐️ <b>Top Up GSTD via Stars</b>\n\n` +
            `${walletStatus}\n\n` +
            `📊 <b>Rate:</b> 1⭐ = ${gstdPerStar.toFixed(0)} GSTD ($${STAR_USD})\n` +
            `📊 GSTD = $${gstdPrice > 0 ? gstdPrice.toFixed(6) : '~0.0002'}\n\n` +
            tierLines.join('\n') + '\n\n' +
            `💡 <i>ChatGPT Plus = $20/mo ≈ ${chatgptReqs} requests\n` +
            `GSTD Pro: $0.005/request — ${Math.floor(20 / (50 * STAR_USD))}× cheaper!</i>` +
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
                `<i>40× дешевле ChatGPT Plus!</i>`
                : `📖 <b>Help</b>\n\n` +
                `🆓 <b>Free AI</b> — just type, always available (Kimi K2 · LLaMA4 · GPT-OSS-120B)\n` +
                `⚡ <b>Sovereign Pro</b> — 0.1 GSTD/request, best swarm models\n\n` +
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
