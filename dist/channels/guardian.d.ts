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
import { Bot } from 'grammy';
interface GuardianConfig {
    swarmUrl: string;
    botUsername: string;
    adminIds: number[];
    enableBuyAlerts: boolean;
    buyAlertChatId?: number;
}
export declare class CommunityGuardian {
    private users;
    private messageTimestamps;
    private config;
    private router;
    private priceCache;
    private groupMemory;
    constructor(config: GuardianConfig);
    registerHandlers(bot: Bot<any>): void;
    private detectLang;
    private isGroup;
    private isAdminImpersonation;
    private isProfanity;
    private isSpam;
    private isFlood;
    private trackMessage;
    private warnUser;
    private muteUser;
    private fetchPrice;
    private fetchStats;
    startBuyAlerts(bot: Bot<any>, chatId: number): void;
}
export {};
//# sourceMappingURL=guardian.d.ts.map