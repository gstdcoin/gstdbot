/**
 * GSTD Community Guardian v2 — Intelligent AI Agent for Group Moderation
 * 
 * Features:
 * - AI-powered contextual responses (uses the swarm for answers)
 * - Bilingual: auto-detects RU/EN and responds accordingly
 * - Smart admin impersonation detection
 * - Profanity & hate speech filtering (RU + EN)
 * - Learns from context (maintains group conversation memory)
 * - Helps with token purchase guidance
 * - Demonstrates intelligence through helpful, detailed answers
 * - Never reveals secrets (API keys, architecture, etc.)
 */

import { Bot, Context } from 'grammy';
import { NeuralRouter } from '../gateway/router.js';

interface GuardianConfig {
    swarmUrl: string;
    botUsername: string;
    adminIds: number[];
    enableBuyAlerts: boolean;
    buyAlertChatId?: number;
}

interface UserRecord {
    messageCount: number;
    lastMessage: number;
    warnings: number;
    joinTime: number;
    lang: string; // detected language
}

// ─── Spam patterns ───
const SPAM_PATTERNS = [
    /t\.me\/(?!gstd|GstdAppBot)[\w]+/i,
    /(?:free\s*airdrop|earn\s*\$?\d+|click\s*here)/i,
    /(?:invest\s*now|guaranteed\s*profit|100x|1000x)/i,
    /(?:whatsapp|signal)\.(?:com|me)/i,
    /bit\.ly|tinyurl|short\.link|tiny\.cc/i,
    /(?:send\s*\d+\s*(?:ton|eth|btc|usdt))/i,
    /(?:dm|pm)\s*(?:me|for|to)\s*(?:invest|earn|profit)/i,
    /(?:восхитительн|потряса)\w*\s*(?:заработ|доход)/i, // RU spam
];

// ─── Profanity filter (RU + EN) ───
const PROFANITY_PATTERNS = [
    // English
    /\b(?:fuck|shit|bitch|ass(?:hole)?|cunt|dick|pussy|nigger|faggot|retard)\b/i,
    /\b(?:stfu|gtfo|wtf|lmao)\b/i,
    // Russian mat
    /(?:бля[дть]|ху[йёея]|пизд|ебат|ёб|еб[аиу]|сук[аи]|мудак|пидор|дерьм|гандон|хер\b|нах[уе][йи])/iu,
    /(?:долбо[её]б|заеб|отъеб|выеб)/iu,
];

// ─── Admin impersonation detection ───
const ADMIN_IMPERSONATION_PATTERNS = [
    /(?:я\s*(?:админ|администратор|модератор|основатель|создатель|owner))/iu,
    /(?:i\s*am\s*(?:admin|moderator|owner|founder|developer|support))/i,
    /(?:official\s*(?:admin|support|team))/i,
    /(?:напишите\s*мне\s*в\s*(?:лс|личку|pm|dm))/iu,
    /(?:write\s*(?:me|to\s*me)\s*(?:in\s*)?(?:dm|pm|private))/i,
    /(?:обратитесь\s*ко\s*мне)/iu,
];

// ─── Forbidden knowledge ───
const FORBIDDEN_TOPICS = [
    'api key', 'api_key', 'secret', 'password', 'private key', 'seed phrase',
    'mnemonic', 'database', 'server ip', 'ssh', '.env', 'groq', 'huggingface',
    'hf_token', 'internal architecture', 'admin panel', 'server config',
    'серверн', 'пароль', 'приватн.*ключ', 'сид.*фраз', 'база данн',
];

// ─── Platform knowledge base ───
const PLATFORM_KB = {
    website: 'https://app.gstdtoken.com',
    chat: 'https://app.gstdtoken.com/chat',
    monitor: 'https://monitor.gstdtoken.com',
    bot: 'https://t.me/GstdAppBot',
    contract: 'EQAIYlrr3UiMJ9fqI-B4j2nJdiiD7WzyaNL1MX_wiONc4OUi',
    chain: 'TON',
    buyLinks: {
        stonfi: 'https://app.ston.fi/swap?ft=TON&tt=GSTD',
        dedust: 'https://dedust.io/swap/TON/GSTD',
    },
};

const FLOOD_LIMIT = 5;
const FLOOD_WINDOW_MS = 10000;
const NEW_USER_RESTRICT_MS = 300000;

export class CommunityGuardian {
    private users: Map<number, UserRecord> = new Map();
    private messageTimestamps: Map<number, number[]> = new Map();
    private config: GuardianConfig;
    private router: NeuralRouter;
    private priceCache: { price: number; ts: number } = { price: 0, ts: 0 };
    private groupMemory: Array<{ role: string; content: string }> = [];

    constructor(config: GuardianConfig) {
        this.config = config;
        this.router = new NeuralRouter(config.swarmUrl, false);
    }

    registerHandlers(bot: Bot<any>): void {
        // ─── Pre-filter: spam, profanity, impersonation ───
        bot.on('message', async (ctx, next) => {
            if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') return next();
            const userId = ctx.from?.id;
            if (!userId) return next();
            if (this.config.adminIds.includes(userId)) return next();

            const text = ctx.message?.text || ctx.message?.caption || '';

            // Admin impersonation check
            if (this.isAdminImpersonation(text, ctx)) {
                try {
                    await ctx.deleteMessage();
                    const w = this.warnUser(userId);
                    const lang = this.detectLang(text);
                    if (w >= 2) {
                        await this.muteUser(ctx, userId, 7200);
                        await ctx.reply(lang === 'ru'
                            ? '🚫 Пользователь заблокирован за попытку выдать себя за администратора.'
                            : '🚫 User blocked for impersonating an admin.');
                    } else {
                        await ctx.reply(lang === 'ru'
                            ? '⚠️ Вы не являетесь администратором. Только официальные админы могут управлять чатом.'
                            : '⚠️ You are not an admin. Only official admins can manage the chat.',
                            { reply_to_message_id: ctx.message?.message_id });
                    }
                } catch { }
                return;
            }

            // Profanity check
            if (this.isProfanity(text)) {
                try {
                    await ctx.deleteMessage();
                    const w = this.warnUser(userId);
                    const lang = this.detectLang(text);
                    if (w >= 3) {
                        await this.muteUser(ctx, userId, 3600);
                        await ctx.reply(lang === 'ru'
                            ? '🔇 Пользователь заглушен на 1 час за нарушение правил.'
                            : '🔇 User muted for 1 hour for rule violations.');
                    } else {
                        await ctx.reply(lang === 'ru'
                            ? `⚠️ Мат и грубость запрещены. Предупреждение ${w}/3.`
                            : `⚠️ Profanity is not allowed. Warning ${w}/3.`,
                            { reply_to_message_id: undefined });
                    }
                } catch { }
                return;
            }

            // Spam check
            if (await this.isSpam(ctx, text)) {
                try {
                    await ctx.deleteMessage();
                    this.warnUser(userId);
                } catch { }
                return;
            }

            // Flood check
            if (this.isFlood(userId)) {
                try { await ctx.deleteMessage(); } catch { }
                return;
            }

            this.trackMessage(userId);
            return next();
        });

        // ─── Welcome new members ───
        bot.on('message:new_chat_members', async (ctx) => {
            if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') return;
            const members = ctx.message?.new_chat_members || [];
            for (const member of members) {
                if (member.is_bot && member.id !== bot.botInfo?.id) {
                    const addedBy = ctx.from?.id;
                    if (addedBy && !this.config.adminIds.includes(addedBy)) {
                        try { await ctx.banChatMember(member.id); } catch { }
                    }
                    continue;
                }
                this.users.set(member.id, { messageCount: 0, lastMessage: Date.now(), warnings: 0, joinTime: Date.now(), lang: 'en' });
                const name = member.first_name || 'друг';
                await ctx.reply(
                    `👋 Добро пожаловать, *${name}*! Welcome!\n\n` +
                    `Это чат сообщества GSTD — децентрализованного AI.\n` +
                    `This is the GSTD community — decentralized AI platform.\n\n` +
                    `🤖 /gstd — О платформе / About\n` +
                    `💰 /price — Цена токена / Token price\n` +
                    `🛒 /buy — Как купить / How to buy\n\n` +
                    `_Правила: без спама, мата и рекламы._\n` +
                    `_Rules: no spam, profanity, or ads._`,
                    { parse_mode: 'Markdown' }
                );
            }
        });

        // ─── Commands ───
        bot.command('gstd', async (ctx) => {
            if (!this.isGroup(ctx)) return;
            const lang = this.detectLang(ctx.message?.text || '');
            if (lang === 'ru') {
                await ctx.reply(
                    `🐝 *GSTD — Децентрализованная AI Платформа*\n\n` +
                    `GSTD — это суверенная вычислительная сеть. Запускайте AI модели, зарабатывайте токены, владейте своими данными.\n\n` +
                    `🌐 *Дашборд:* [app.gstdtoken.com](${PLATFORM_KB.website})\n` +
                    `💬 *AI Чат:* [Бесплатный AI](${PLATFORM_KB.chat}) — без регистрации\n` +
                    `📊 *Монитор:* [Статистика сети](${PLATFORM_KB.monitor})\n` +
                    `🤖 *Бот:* @${this.config.botUsername}\n\n` +
                    `*Преимущества:*\n` +
                    `• 🛡 Ваши данные не покидают сеть\n` +
                    `• 💰 Зарабатывайте GSTD, подключив устройство\n` +
                    `• 🆓 AI чат бесплатный\n` +
                    `• 🏦 Золотой резерв обеспечивает стоимость\n\n` +
                    `Контракт: \`${PLATFORM_KB.contract}\``,
                    { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
                );
            } else {
                await ctx.reply(
                    `🐝 *GSTD — Decentralized AI Platform*\n\n` +
                    `GSTD is a sovereign compute network. Run AI models, earn tokens, own your data.\n\n` +
                    `🌐 *Dashboard:* [app.gstdtoken.com](${PLATFORM_KB.website})\n` +
                    `💬 *AI Chat:* [Free AI Chat](${PLATFORM_KB.chat}) — no signup\n` +
                    `📊 *Monitor:* [Network Stats](${PLATFORM_KB.monitor})\n` +
                    `🤖 *Bot:* @${this.config.botUsername}\n\n` +
                    `*Why GSTD:*\n` +
                    `• 🛡 Your data stays sovereign\n` +
                    `• 💰 Earn GSTD by connecting devices\n` +
                    `• 🆓 AI chat is free\n` +
                    `• 🏦 Gold reserve backs the token\n\n` +
                    `Contract: \`${PLATFORM_KB.contract}\``,
                    { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
                );
            }
        });

        bot.command('price', async (ctx) => {
            if (!this.isGroup(ctx)) return;
            const price = await this.fetchPrice();
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(
                lang === 'ru'
                    ? `📈 *Цена GSTD*\n\n💰 $${price.toFixed(8)}\n🔗 Сеть: TON\n📊 [График](${PLATFORM_KB.buyLinks.stonfi})\n\n_Обновлено только что_`
                    : `📈 *GSTD Price*\n\n💰 $${price.toFixed(8)}\n🔗 Chain: TON\n📊 [Chart](${PLATFORM_KB.buyLinks.stonfi})\n\n_Updated just now_`,
                { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
            );
        });

        bot.command('buy', async (ctx) => {
            if (!this.isGroup(ctx)) return;
            const lang = this.detectLang(ctx.message?.text || '');
            const price = await this.fetchPrice();
            await ctx.reply(
                lang === 'ru'
                    ? `🛒 *Как купить GSTD*\n\n` +
                    `1️⃣ Установите TON кошелёк (Tonkeeper или MyTonWallet)\n` +
                    `2️⃣ Купите TON на бирже или P2P\n` +
                    `3️⃣ Обменяйте TON → GSTD:\n\n` +
                    `• [STON.fi](${PLATFORM_KB.buyLinks.stonfi}) — основная DEX\n` +
                    `• [DeDust](${PLATFORM_KB.buyLinks.dedust}) — альтернатива\n\n` +
                    `💰 Текущая цена: $${price.toFixed(8)}\n` +
                    `📋 Контракт: \`${PLATFORM_KB.contract}\`\n\n` +
                    `_⚠️ Всегда проверяйте адрес контракта перед покупкой!_\n\n` +
                    `⭐ Или купите через Telegram Stars: /buy\\_stars`
                    : `🛒 *How to Buy GSTD*\n\n` +
                    `1️⃣ Install a TON wallet (Tonkeeper or MyTonWallet)\n` +
                    `2️⃣ Buy TON on an exchange or P2P\n` +
                    `3️⃣ Swap TON → GSTD:\n\n` +
                    `• [STON.fi](${PLATFORM_KB.buyLinks.stonfi}) — main DEX\n` +
                    `• [DeDust](${PLATFORM_KB.buyLinks.dedust}) — alternative\n\n` +
                    `💰 Current price: $${price.toFixed(8)}\n` +
                    `📋 Contract: \`${PLATFORM_KB.contract}\`\n\n` +
                    `_⚠️ Always verify the contract address before buying!_\n\n` +
                    `⭐ Or buy with Telegram Stars: /buy\\_stars`,
                { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
            );
        });

        // ─── Buy with Telegram Stars ───
        bot.command('buy_stars', async (ctx) => {
            const lang = this.detectLang(ctx.message?.text || '');
            const userId = ctx.from?.id;
            if (!userId) return;

            // Parse amount: /buy_stars 100
            const args = (ctx.message?.text || '').split(' ').slice(1);
            const starsAmount = parseInt(args[0]) || 50;
            const gstdAmount = starsAmount * 10; // 1 Star = 10 GSTD

            try {
                await ctx.api.sendInvoice(
                    ctx.chat!.id,
                    lang === 'ru' ? `Покупка ${gstdAmount} GSTD` : `Buy ${gstdAmount} GSTD`,
                    lang === 'ru'
                        ? `Вы получите ${gstdAmount} GSTD токенов на ваш привязанный кошелёк. 1 Star = 10 GSTD.`
                        : `You will receive ${gstdAmount} GSTD tokens to your linked wallet. 1 Star = 10 GSTD.`,
                    `gstd_purchase_${userId}_${Date.now()}`, // unique payload
                    'XTR', // Stars currency
                    [{ label: `${gstdAmount} GSTD`, amount: starsAmount }],
                );
            } catch (err: any) {
                console.error('[Guardian] Invoice error:', err.message);
                await ctx.reply(
                    lang === 'ru'
                        ? '❌ Не удалось создать счёт. Попробуйте через DEX:\n' + PLATFORM_KB.buyLinks.stonfi
                        : '❌ Failed to create invoice. Try via DEX:\n' + PLATFORM_KB.buyLinks.stonfi
                );
            }
        });

        // Handle pre-checkout query (must answer in 10 seconds)
        bot.on('pre_checkout_query', async (ctx) => {
            try {
                await ctx.answerPreCheckoutQuery(true);
            } catch (err: any) {
                console.error('[Guardian] Pre-checkout error:', err.message);
            }
        });

        // Handle successful payment — deliver tokens
        bot.on('message:successful_payment', async (ctx) => {
            const payment = ctx.message?.successful_payment;
            if (!payment) return;

            const userId = ctx.from?.id;
            const totalPaid = payment.total_amount; // Stars
            const gstdAmount = totalPaid * 10; // 1 Star = 10 GSTD
            const lang = this.detectLang('');

            try {
                // Call backend to credit tokens
                const res = await fetch(`${this.config.swarmUrl}/api/v1/telegram/buy-stars`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_id: userId,
                        stars_amount: totalPaid,
                        gstd_amount: gstdAmount,
                        payment_id: payment.telegram_payment_charge_id,
                    }),
                });

                if (res.ok) {
                    const data: any = await res.json();
                    await ctx.reply(
                        `✅ *${lang === 'ru' ? 'Покупка успешна' : 'Purchase Successful'}!*\n\n` +
                        `💰 ${gstdAmount} GSTD → ${data.wallet ? data.wallet.slice(0, 8) + '...' : lang === 'ru' ? 'ваш кошелёк' : 'your wallet'}\n` +
                        `⭐ ${lang === 'ru' ? 'Оплачено' : 'Paid'}: ${totalPaid} Stars\n` +
                        `📋 ID: \`${payment.telegram_payment_charge_id}\`\n\n` +
                        `${lang === 'ru' ? 'Баланс обновлён на дашборде' : 'Balance updated on dashboard'}: [${PLATFORM_KB.website}](${PLATFORM_KB.website}/dashboard)`,
                        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
                    );
                } else {
                    // Refund if backend fails
                    console.error('[Guardian] Token delivery failed, refunding');
                    try {
                        await ctx.api.refundStarPayment(userId!, payment.telegram_payment_charge_id);
                        await ctx.reply(
                            lang === 'ru'
                                ? '⚠️ Произошла ошибка. Stars возвращены на ваш счёт.'
                                : '⚠️ An error occurred. Stars have been refunded.'
                        );
                    } catch {
                        await ctx.reply(
                            lang === 'ru'
                                ? '⚠️ Ошибка при доставке токенов. Обратитесь к @администратору.'
                                : '⚠️ Error delivering tokens. Contact an admin.'
                        );
                    }
                }
            } catch (err: any) {
                console.error('[Guardian] Payment processing error:', err.message);
                await ctx.reply(
                    lang === 'ru'
                        ? '⚠️ Ошибка обработки платежа. Обратитесь к администратору.'
                        : '⚠️ Payment processing error. Contact an admin.'
                );
            }
        });

        bot.command('stats', async (ctx) => {
            if (!this.isGroup(ctx)) return;
            const stats = await this.fetchStats();
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(
                lang === 'ru'
                    ? `📊 *Статистика сети GSTD*\n\n🖥 Узлы: ${stats.active_workers}\n📝 Задач (24ч): ${stats.tasks_24h}\n💰 Выплачено: ${stats.total_gstd_paid} GSTD\n📈 Цена: $${stats.gstd_price_usd?.toFixed(8) || '0'}\n\n_[monitor.gstdtoken.com](${PLATFORM_KB.monitor})_`
                    : `📊 *GSTD Network Stats*\n\n🖥 Workers: ${stats.active_workers}\n📝 Tasks (24h): ${stats.tasks_24h}\n💰 Paid: ${stats.total_gstd_paid} GSTD\n📈 Price: $${stats.gstd_price_usd?.toFixed(8) || '0'}\n\n_[monitor.gstdtoken.com](${PLATFORM_KB.monitor})_`,
                { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
            );
        });

        bot.command('help', async (ctx) => {
            if (!this.isGroup(ctx)) return;
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(
                lang === 'ru'
                    ? `🐝 *GSTD Бот — Команды*\n\n/gstd — О платформе\n/price — Цена токена\n/buy — Как купить\n/stats — Статистика\n/help — Помощь\n\nТакже вы можете @упомянуть меня и задать вопрос!`
                    : `🐝 *GSTD Bot — Commands*\n\n/gstd — About the platform\n/price — Token price\n/buy — How to buy\n/stats — Statistics\n/help — Help\n\nYou can also @mention me and ask any question!`,
                { parse_mode: 'Markdown' }
            );
        });

        // ─── Intelligent AI responses (@ mentions and replies) ───
        bot.on('message:text', async (ctx, next) => {
            if (!this.isGroup(ctx)) return next();

            const text = ctx.message?.text || '';
            const isMentioned = text.toLowerCase().includes(`@${this.config.botUsername?.toLowerCase()}`);
            const isReply = ctx.message?.reply_to_message?.from?.id === bot.botInfo?.id;
            if (!isMentioned && !isReply) return next();

            // Detect language
            const lang = this.detectLang(text);

            // Check forbidden topics
            if (FORBIDDEN_TOPICS.some(t => text.toLowerCase().includes(t))) {
                await ctx.reply(
                    lang === 'ru'
                        ? '🔒 Я не могу делиться внутренними техническими деталями. Спросите о функциях, ценах или как начать!'
                        : '🔒 I can\'t share internal technical details. Ask about features, prices, or how to get started!',
                    { reply_to_message_id: ctx.message?.message_id }
                );
                return;
            }

            // Clean mention from text
            const cleanText = text.replace(new RegExp(`@${this.config.botUsername}`, 'gi'), '').trim();
            if (!cleanText) return;

            // Show typing
            await ctx.api.sendChatAction(ctx.chat!.id, 'typing');

            // Build smart system prompt
            const systemPrompt = lang === 'ru'
                ? `Ты — GSTD Bot, интеллектуальный AI-ассистент платформы GSTD в групповом чате Telegram.

ПРАВИЛА:
- Отвечай на русском языке
- Будь дружелюбным, полезным и конкретным
- Максимум 200 слов в ответе
- Знай всё о платформе GSTD:
  • GSTD — децентрализованная AI платформа на блокчейне TON
  • Пользователи могут бесплатно общаться с AI: ${PLATFORM_KB.chat}
  • Зарабатывать GSTD подключив устройства как узлы
  • Токен GSTD обеспечен золотым резервом (XAUt)
  • Контракт: ${PLATFORM_KB.contract}
  • Купить на STON.fi или DeDust
  • Дашборд: ${PLATFORM_KB.website}
- НИКОГДА не раскрывай API ключи, пароли, серверные данные
- При вопросах о покупке — давай ссылки на DEX
- Демонстрируй экспертизу и интеллект`
                : `You are GSTD Bot, an intelligent AI assistant for the GSTD platform in a Telegram group chat.

RULES:
- Respond in English
- Be friendly, helpful, and specific
- Max 200 words per response
- Know everything about GSTD:
  • GSTD is a decentralized AI platform on TON blockchain
  • Users can chat with AI for free: ${PLATFORM_KB.chat}
  • Earn GSTD by connecting devices as nodes
  • GSTD token is backed by gold reserve (XAUt)
  • Contract: ${PLATFORM_KB.contract}
  • Buy on STON.fi or DeDust
  • Dashboard: ${PLATFORM_KB.website}
- NEVER reveal API keys, passwords, server details
- When asked about buying — provide DEX links
- Demonstrate expertise and intelligence`;

            // Include recent group context for continuity
            const contextMessages = this.groupMemory.slice(-6).map(m => ({
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content,
            }));
            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                { role: 'system', content: systemPrompt },
                ...contextMessages,
                { role: 'user', content: cleanText },
            ];

            try {
                const result = await this.router.route('auto', messages);

                // Store in group memory
                this.groupMemory.push({ role: 'user', content: cleanText });
                this.groupMemory.push({ role: 'assistant', content: result.content });
                if (this.groupMemory.length > 20) {
                    this.groupMemory = this.groupMemory.slice(-14);
                }

                await ctx.reply(result.content, {
                    parse_mode: 'Markdown',
                    reply_to_message_id: ctx.message?.message_id,
                });
            } catch (err: any) {
                console.error('[Guardian] AI error:', err.message);
                await ctx.reply(
                    lang === 'ru' ? 'Произошла ошибка. Попробуйте ещё раз.' : 'Something went wrong. Try again.',
                    { reply_to_message_id: ctx.message?.message_id }
                );
            }
        });

        console.log('[Guardian] Intelligent community moderation active');
    }

    // ─── Detection methods ───

    private detectLang(text: string): string {
        const cyrillic = (text.match(/[а-яёА-ЯЁ]/g) || []).length;
        const latin = (text.match(/[a-zA-Z]/g) || []).length;
        return cyrillic > latin * 0.3 ? 'ru' : 'en';
    }

    private isGroup(ctx: any): boolean {
        return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    }

    private isAdminImpersonation(text: string, ctx: any): boolean {
        const userId = ctx.from?.id;
        if (this.config.adminIds.includes(userId)) return false;
        return ADMIN_IMPERSONATION_PATTERNS.some(p => p.test(text));
    }

    private isProfanity(text: string): boolean {
        return PROFANITY_PATTERNS.some(p => p.test(text));
    }

    private async isSpam(ctx: any, text: string): Promise<boolean> {
        if (!text) return false;
        for (const p of SPAM_PATTERNS) {
            if (p.test(text)) return true;
        }
        const userId = ctx.from?.id;
        const user = this.users.get(userId);
        if (user && Date.now() - user.joinTime < NEW_USER_RESTRICT_MS) {
            if (/https?:\/\/|t\.me\/|@\w{5,}/.test(text)) return true;
        }
        if (ctx.message?.forward_origin && user && Date.now() - user.joinTime < NEW_USER_RESTRICT_MS) {
            return true;
        }
        return false;
    }

    private isFlood(userId: number): boolean {
        const now = Date.now();
        const ts = this.messageTimestamps.get(userId) || [];
        const recent = ts.filter(t => now - t < FLOOD_WINDOW_MS);
        this.messageTimestamps.set(userId, recent);
        return recent.length >= FLOOD_LIMIT;
    }

    private trackMessage(userId: number): void {
        const ts = this.messageTimestamps.get(userId) || [];
        ts.push(Date.now());
        this.messageTimestamps.set(userId, ts.slice(-10));
    }

    private warnUser(userId: number): number {
        const u = this.users.get(userId) || { messageCount: 0, lastMessage: Date.now(), warnings: 0, joinTime: Date.now(), lang: 'en' };
        u.warnings++;
        this.users.set(userId, u);
        return u.warnings;
    }

    private async muteUser(ctx: any, userId: number, seconds: number): Promise<void> {
        try {
            await ctx.restrictChatMember(userId, {
                permissions: { can_send_messages: false },
                until_date: Math.floor(Date.now() / 1000) + seconds,
            });
        } catch { }
    }

    // ─── API methods ───

    private async fetchPrice(): Promise<number> {
        if (Date.now() - this.priceCache.ts < 60000) return this.priceCache.price;
        try {
            const res = await fetch(`${this.config.swarmUrl}/api/v1/market/price`);
            const data: any = await res.json();
            this.priceCache = { price: data.gstd_price_usd || 0, ts: Date.now() };
            return this.priceCache.price;
        } catch {
            return this.priceCache.price;
        }
    }

    private async fetchStats(): Promise<any> {
        try {
            const res = await fetch(`${this.config.swarmUrl}/api/v1/network/stats`);
            return await res.json();
        } catch {
            return { active_workers: 0, tasks_24h: 0, total_gstd_paid: 0, gstd_price_usd: 0 };
        }
    }

    startBuyAlerts(bot: Bot<any>, chatId: number): void {
        let lastPrice = 0;
        setInterval(async () => {
            try {
                const price = await this.fetchPrice();
                if (lastPrice > 0 && price > lastPrice * 1.02) {
                    const pct = ((price - lastPrice) / lastPrice * 100).toFixed(1);
                    await bot.api.sendMessage(chatId,
                        `🟢 *Покупка GSTD! / GSTD Buy Alert!*\n\n` +
                        `💰 Цена / Price: $${price.toFixed(8)} (+${pct}%)\n` +
                        `📈 [Купить / Buy](${PLATFORM_KB.buyLinks.stonfi})`,
                        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
                    );
                }
                lastPrice = price;
            } catch { }
        }, 30000);
        console.log(`[Guardian] Buy alerts for chat ${chatId}`);
    }
}
