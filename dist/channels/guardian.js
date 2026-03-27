"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityGuardian = void 0;
const router_js_1 = require("../gateway/router.js");
// ─── Spam patterns ───
const SPAM_PATTERNS = [
    /t\.me\/(?!gstd|GstdAppBot)[\w]+/i,
    /(?:free\s*airdrop|earn\s*\$?\d+|click\s*here)/i,
    /(?:invest\s*now|guaranteed\s*profit|100x|1000x)/i,
    /(?:whatsapp|signal)\.(?:com|me)/i,
    /bit\.ly|tinyurl|short\.link|tiny\.cc/i,
    /(?:send\s*\d+\s*(?:ton|eth|btc|usdt))/i,
    /(?:dm|pm)\s*(?:me|for|to)\s*(?:invest|earn|profit)/i,
];
// ─── Profanity filter (RU + EN) ───
const PROFANITY_PATTERNS = [
    // English
    /\b(?:fuck|shit|bitch|ass(?:hole)?|cunt|dick|pussy|nigger|faggot|retard)\b/i,
    /\b(?:stfu|gtfo|wtf|lmao)\b/i,
];
// ─── Admin impersonation detection ───
const ADMIN_IMPERSONATION_PATTERNS = [
    /(?:i\s*am\s*(?:admin|moderator|owner|founder|developer|support))/i,
    /(?:official\s*(?:admin|support|team))/i,
    /(?:write\s*(?:me|to\s*me)\s*(?:in\s*)?(?:dm|pm|private))/i,
];
// ─── Forbidden knowledge ───
const FORBIDDEN_TOPICS = [
    'api key', 'api_key', 'secret', 'password', 'private key', 'seed phrase',
    'mnemonic', 'database', 'server ip', 'ssh', '.env', 'groq', 'huggingface',
    'hf_token', 'internal architecture', 'admin panel', 'server config',
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
class CommunityGuardian {
    users = new Map();
    messageTimestamps = new Map();
    config;
    router;
    priceCache = { price: 0, ts: 0 };
    groupMemory = [];
    constructor(config) {
        this.config = config;
        this.router = new router_js_1.NeuralRouter(config.swarmUrl, false);
    }
    registerHandlers(bot) {
        // ─── Pre-filter: spam, profanity, impersonation ───
        bot.on('message', async (ctx, next) => {
            if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup')
                return next();
            const userId = ctx.from?.id;
            if (!userId)
                return next();
            if (this.config.adminIds.includes(userId))
                return next();
            const text = ctx.message?.text || ctx.message?.caption || '';
            // Admin impersonation check
            if (this.isAdminImpersonation(text, ctx)) {
                try {
                    await ctx.deleteMessage();
                    const w = this.warnUser(userId);
                    const lang = this.detectLang(text);
                    if (w >= 2) {
                        await this.muteUser(ctx, userId, 7200);
                        await ctx.reply('🚫 User blocked for impersonating an admin.');
                    }
                    else {
                        await ctx.reply('⚠️ You are not an admin. Only official admins can manage the chat.', { reply_to_message_id: ctx.message?.message_id });
                    }
                }
                catch (_e) { }
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
                        await ctx.reply('🔇 User muted for 1 hour for rule violations.');
                    }
                    else {
                        await ctx.reply(`⚠️ Profanity is not allowed. Warning ${w}/3.`, { reply_to_message_id: undefined });
                    }
                }
                catch (_e) { }
                return;
            }
            // Spam check
            if (await this.isSpam(ctx, text)) {
                try {
                    await ctx.deleteMessage();
                    this.warnUser(userId);
                }
                catch (_e) { }
                return;
            }
            // Flood check
            if (this.isFlood(userId)) {
                try {
                    await ctx.deleteMessage();
                }
                catch (_e) { }
                return;
            }
            this.trackMessage(userId);
            return next();
        });
        // ─── Welcome new members ───
        bot.on('message:new_chat_members', async (ctx) => {
            if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup')
                return;
            const members = ctx.message?.new_chat_members || [];
            for (const member of members) {
                if (member.is_bot && member.id !== bot.botInfo?.id) {
                    const addedBy = ctx.from?.id;
                    if (addedBy && !this.config.adminIds.includes(addedBy)) {
                        try {
                            await ctx.banChatMember(member.id);
                        }
                        catch (_e) { }
                    }
                    continue;
                }
                this.users.set(member.id, { messageCount: 0, lastMessage: Date.now(), warnings: 0, joinTime: Date.now(), lang: 'en' });
                const name = member.first_name || 'friend';
                await ctx.reply(`👋 Welcome, *${name}*!\n\n` +
                    `This is the GSTD community — decentralized AI platform.\n\n` +
                    `🤖 /gstd — About\n` +
                    `💰 /price — Token price\n` +
                    `🛒 /buy — How to buy\n\n` +
                    `_Rules: no spam, profanity, or ads._`, { parse_mode: 'Markdown' });
            }
        });
        // ─── Commands ───
        bot.command('gstd', async (ctx) => {
            if (!this.isGroup(ctx))
                return;
            const lang = this.detectLang(ctx.message?.text || '');
            {
                await ctx.reply(`🐝 *GSTD — Decentralized AI Platform*\n\n` +
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
                    `Contract: \`${PLATFORM_KB.contract}\``, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
            }
        });
        bot.command('price', async (ctx) => {
            if (!this.isGroup(ctx))
                return;
            const price = await this.fetchPrice();
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(`📈 *GSTD Price*\n\n💰 $${price.toFixed(8)}\n🔗 Chain: TON\n📊 [Chart](${PLATFORM_KB.buyLinks.stonfi})\n\n_Updated just now_`, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
        });
        bot.command('buy', async (ctx) => {
            if (!this.isGroup(ctx))
                return;
            const lang = this.detectLang(ctx.message?.text || '');
            const price = await this.fetchPrice();
            await ctx.reply(`🛒 *How to Buy GSTD*\n\n` +
                `1️⃣ Install a TON wallet (Tonkeeper or MyTonWallet)\n` +
                `2️⃣ Buy TON on an exchange or P2P\n` +
                `3️⃣ Swap TON → GSTD:\n\n` +
                `• [STON.fi](${PLATFORM_KB.buyLinks.stonfi}) — main DEX\n` +
                `• [DeDust](${PLATFORM_KB.buyLinks.dedust}) — alternative\n\n` +
                `💰 Current price: $${price.toFixed(8)}\n` +
                `📋 Contract: \`${PLATFORM_KB.contract}\`\n\n` +
                `_⚠️ Always verify the contract address before buying!_\n\n` +
                `⭐ Or buy with Telegram Stars: /buy\\_stars`, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
        });
        // ─── Buy with Telegram Stars ───
        bot.command('buy_stars', async (ctx) => {
            const lang = this.detectLang(ctx.message?.text || '');
            const userId = ctx.from?.id;
            if (!userId)
                return;
            // Parse amount: /buy_stars 100
            const args = (ctx.message?.text || '').split(' ').slice(1);
            const starsAmount = parseInt(args[0]) || 50;
            // Real exchange rate: 1 Star ≈ $0.013 (Telegram official rate)
            const STAR_USD = 0.013;
            const gstdPrice = await this.fetchPrice();
            // How many GSTD per Star at market price
            const gstdPerStar = gstdPrice > 0 ? STAR_USD / gstdPrice : 10;
            const gstdAmount = Math.floor(starsAmount * gstdPerStar);
            // Comparison removed: no external product mentions
            const usdTotal = (starsAmount * STAR_USD).toFixed(2);
            const proRequests = Math.floor(gstdAmount / 0.1);
            try {
                const title = `${gstdAmount} GSTD (${proRequests} Pro requests)`;
                const desc = `${starsAmount}⭐ = $${usdTotal} = ${gstdAmount} GSTD = ${proRequests} Pro requests.`;
                await ctx.api.sendInvoice(ctx.chat.id, title, desc, `gstd_purchase_${userId}_${Date.now()}`, 'XTR', [{ label: title, amount: starsAmount }]);
            }
            catch (err) {
                console.error('[Guardian] Invoice error:', err.message);
                await ctx.reply('❌ Failed to create invoice. Try via DEX:\n' + PLATFORM_KB.buyLinks.stonfi);
            }
        });
        // Handle pre-checkout query (must answer in 10 seconds)
        bot.on('pre_checkout_query', async (ctx) => {
            try {
                await ctx.answerPreCheckoutQuery(true);
            }
            catch (err) {
                console.error('[Guardian] Pre-checkout error:', err.message);
            }
        });
        // Handle successful payment — deliver tokens with real rate
        bot.on('message:successful_payment', async (ctx) => {
            const payment = ctx.message?.successful_payment;
            if (!payment)
                return;
            const userId = ctx.from?.id;
            const totalStars = payment.total_amount;
            const lang = ctx.from?.language_code?.startsWith('ru') ? 'ru' : 'en';
            // Calculate real GSTD amount from market price
            const STAR_USD = 0.013;
            const gstdPrice = await this.fetchPrice();
            const gstdPerStar = gstdPrice > 0 ? STAR_USD / gstdPrice : 10;
            const gstdAmount = Math.floor(totalStars * gstdPerStar);
            const usdPaid = (totalStars * STAR_USD).toFixed(2);
            // Check if this is a monitor signal purchase
            const invoicePayload = payment.invoice_payload || '';
            const isMonitorLaunch = invoicePayload.startsWith('monitor_launch:');
            let taskId = '';
            let signalReward = 0;
            if (isMonitorLaunch) {
                const parts = invoicePayload.split(':');
                taskId = parts[1] || '';
                signalReward = parseFloat(parts[3]) || 0;
                console.log(`[Guardian] Monitor signal purchase: task=${taskId} reward=${signalReward}`);
            }
            try {
                // Call backend to credit tokens (server recalculates GSTD amount)
                const res = await fetch(`${this.config.swarmUrl}/api/v1/telegram/buy-stars`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Bot-Token': process.env.TELEGRAM_BOT_TOKEN || '',
                    },
                    body: JSON.stringify({
                        telegram_id: userId,
                        stars_amount: totalStars,
                        gstd_amount: gstdAmount, // hint, server will verify
                        payment_id: payment.telegram_payment_charge_id,
                    }),
                });
                // If this is a monitor signal, also launch the task
                if (isMonitorLaunch && taskId) {
                    try {
                        await fetch(`${this.config.swarmUrl}/api/v1/monitor/signals/${taskId}/sponsor`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Bot-Token': process.env.TELEGRAM_BOT_TOKEN || '',
                            },
                            body: JSON.stringify({
                                user_id: `tg-${userId}`,
                                stars_paid: totalStars,
                                gstd_reward: signalReward,
                                gstd_gold_fee: signalReward * 0.1, // 10% platform fee
                            }),
                        });
                        console.log(`[Guardian] Signal task ${taskId} launched`);
                    }
                    catch (e) {
                        console.error('[Guardian] Signal task launch failed:', e.message);
                    }
                }
                if (res.ok) {
                    const data = await res.json();
                    // Use server-confirmed values (not client estimates)
                    const confirmedGSTD = data.gstd_amount || gstdAmount;
                    const confirmedProReqs = data.pro_requests || Math.floor(confirmedGSTD / 0.1);
                    const confirmedRate = data.rate_per_star || gstdPerStar;
                    const confirmedPrice = data.gstd_price || gstdPrice;
                    const confirmedUSD = data.usd_paid || parseFloat(usdPaid);
                    const walletInfo = data.wallet
                        ? data.wallet.slice(0, 6) + '...' + data.wallet.slice(-4)
                        : ('internal balance');
                    const msg = `✅ <b>Purchase Successful!</b>\n\n` +
                        `💰 <b>${confirmedGSTD} GSTD</b> → ${walletInfo}\n` +
                        `⭐ Paid: ${totalStars} Stars ($${confirmedUSD.toFixed(2)})\n` +
                        `⚡ Pro requests: <b>${confirmedProReqs}</b>\n` +
                        `💵 Cost per request: <b>$${(confirmedUSD / confirmedProReqs).toFixed(5)}</b>\n\n` +
                        `📊 Rate: 1⭐ = ${confirmedRate.toFixed(0)} GSTD\n` +
                        `📊 GSTD = $${confirmedPrice.toFixed(6)}\n\n` +
                        `💡 <i>GSTD Pro: $${confirmedUSD.toFixed(2)} = ${confirmedProReqs} requests ($0.005/req)</i>\n` +
                        `📋 ID: <code>${payment.telegram_payment_charge_id}</code>`;
                    // Add signal task info if applicable
                    if (isMonitorLaunch && taskId) {
                        const signalNote = `\n\n🌍 <b>Signal analysis task ${taskId} launched!</b>\n🐝 Swarm is processing this anomaly.`;
                        await ctx.reply(msg + signalNote, { parse_mode: 'HTML' });
                    }
                    else {
                        await ctx.reply(msg, { parse_mode: 'HTML' });
                    }
                }
                else {
                    // Refund if backend fails
                    const errBody = await res.text().catch(() => '');
                    console.error('[Guardian] Token delivery failed:', res.status, errBody);
                    try {
                        await ctx.api.refundStarPayment(userId, payment.telegram_payment_charge_id);
                        await ctx.reply('⚠️ An error occurred. Stars have been refunded.');
                    }
                    catch (_e) {
                        await ctx.reply('⚠️ Error delivering tokens. Contact an admin.');
                    }
                }
            }
            catch (err) {
                console.error('[Guardian] Payment processing error:', err.message);
                await ctx.reply('⚠️ Payment processing error. Contact an admin.');
            }
        });
        bot.command('stats', async (ctx) => {
            if (!this.isGroup(ctx))
                return;
            const stats = await this.fetchStats();
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(`📊 *GSTD Network Stats*\n\n🖥 Workers: ${stats.active_workers}\n📝 Tasks (24h): ${stats.tasks_24h}\n💰 Paid: ${stats.total_gstd_paid} GSTD\n📈 Price: $${stats.gstd_price_usd?.toFixed(8) || '0'}\n\n_[monitor.gstdtoken.com](${PLATFORM_KB.monitor})_`, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
        });
        bot.command('help', async (ctx) => {
            if (!this.isGroup(ctx))
                return;
            const lang = this.detectLang(ctx.message?.text || '');
            await ctx.reply(`🐝 *GSTD Bot — Commands*\n\n/gstd — About the platform\n/price — Token price\n/buy — How to buy\n/stats — Statistics\n/help — Help\n\nYou can also @mention me and ask any question!`, { parse_mode: 'Markdown' });
        });
        // ─── Intelligent AI responses (@ mentions and replies) ───
        bot.on('message:text', async (ctx, next) => {
            if (!this.isGroup(ctx))
                return next();
            const text = ctx.message?.text || '';
            const isMentioned = text.toLowerCase().includes(`@${this.config.botUsername?.toLowerCase()}`);
            const isReply = ctx.message?.reply_to_message?.from?.id === bot.botInfo?.id;
            if (!isMentioned && !isReply)
                return next();
            // Detect language
            const lang = this.detectLang(text);
            // Check forbidden topics
            if (FORBIDDEN_TOPICS.some(t => text.toLowerCase().includes(t))) {
                await ctx.reply('🔒 I can\'t share internal technical details. Ask about features, prices, or how to get started!', { reply_to_message_id: ctx.message?.message_id });
                return;
            }
            // Clean mention from text
            const cleanText = text.replace(new RegExp(`@${this.config.botUsername}`, 'gi'), '').trim();
            if (!cleanText)
                return;
            // Show typing
            await ctx.api.sendChatAction(ctx.chat.id, 'typing');
            // Build smart system prompt
            const systemPrompt = `You are GSTD Bot, an intelligent AI assistant for the GSTD platform in a Telegram group chat.

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
                role: m.role,
                content: m.content,
            }));
            const messages = [
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
            }
            catch (err) {
                console.error('[Guardian] AI error:', err.message);
                await ctx.reply('Something went wrong. Try again.', { reply_to_message_id: ctx.message?.message_id });
            }
        });
        console.log('[Guardian] Intelligent community moderation active');
    }
    // ─── Detection methods ───
    detectLang(text) {
        return 'en';
    }
    isGroup(ctx) {
        return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    }
    isAdminImpersonation(text, ctx) {
        const userId = ctx.from?.id;
        if (this.config.adminIds.includes(userId))
            return false;
        return ADMIN_IMPERSONATION_PATTERNS.some(p => p.test(text));
    }
    isProfanity(text) {
        return PROFANITY_PATTERNS.some(p => p.test(text));
    }
    async isSpam(ctx, text) {
        if (!text)
            return false;
        for (const p of SPAM_PATTERNS) {
            if (p.test(text))
                return true;
        }
        const userId = ctx.from?.id;
        const user = this.users.get(userId);
        if (user && Date.now() - user.joinTime < NEW_USER_RESTRICT_MS) {
            if (/https?:\/\/|t\.me\/|@\w{5,}/.test(text))
                return true;
        }
        if (ctx.message?.forward_origin && user && Date.now() - user.joinTime < NEW_USER_RESTRICT_MS) {
            return true;
        }
        return false;
    }
    isFlood(userId) {
        const now = Date.now();
        const ts = this.messageTimestamps.get(userId) || [];
        const recent = ts.filter(t => now - t < FLOOD_WINDOW_MS);
        this.messageTimestamps.set(userId, recent);
        return recent.length >= FLOOD_LIMIT;
    }
    trackMessage(userId) {
        const ts = this.messageTimestamps.get(userId) || [];
        ts.push(Date.now());
        this.messageTimestamps.set(userId, ts.slice(-10));
    }
    warnUser(userId) {
        const u = this.users.get(userId) || { messageCount: 0, lastMessage: Date.now(), warnings: 0, joinTime: Date.now(), lang: 'en' };
        u.warnings++;
        this.users.set(userId, u);
        return u.warnings;
    }
    async muteUser(ctx, userId, seconds) {
        try {
            await ctx.restrictChatMember(userId, {
                permissions: { can_send_messages: false },
                until_date: Math.floor(Date.now() / 1000) + seconds,
            });
        }
        catch (_e) { }
    }
    // ─── API methods ───
    async fetchPrice() {
        if (Date.now() - this.priceCache.ts < 60000)
            return this.priceCache.price;
        try {
            const res = await fetch(`${this.config.swarmUrl}/api/v1/market/price`);
            const data = await res.json();
            this.priceCache = { price: data.gstd_price_usd || 0, ts: Date.now() };
            return this.priceCache.price;
        }
        catch (_e) {
            return this.priceCache.price;
        }
    }
    async fetchStats() {
        try {
            const res = await fetch(`${this.config.swarmUrl}/api/v1/network/stats`);
            return await res.json();
        }
        catch (_e) {
            return { active_workers: 0, tasks_24h: 0, total_gstd_paid: 0, gstd_price_usd: 0 };
        }
    }
    startBuyAlerts(bot, chatId) {
        let lastPrice = 0;
        setInterval(async () => {
            try {
                const price = await this.fetchPrice();
                if (lastPrice > 0 && price > lastPrice * 1.02) {
                    const pct = ((price - lastPrice) / lastPrice * 100).toFixed(1);
                    await bot.api.sendMessage(chatId, `🟢 *GSTD Buy Alert!*\n\n` +
                        `💰 Price: $${price.toFixed(8)} (+${pct}%)\n` +
                        `📈 [Buy](${PLATFORM_KB.buyLinks.stonfi})`, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } });
                }
                lastPrice = price;
            }
            catch (_e) { }
        }, 30000);
        console.log(`[Guardian] Buy alerts for chat ${chatId}`);
    }
}
exports.CommunityGuardian = CommunityGuardian;
//# sourceMappingURL=guardian.js.map