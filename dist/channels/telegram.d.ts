/**
 * Telegram Channel — grammY-based Telegram bot integration
 * + Community Guardian for group chats
 * + Factuality System Prompt (same as chat.gstdtoken.com)
 * + Redis Knowledge Cache (shared with web chat)
 */
export interface TelegramConfig {
    botToken: string;
    swarmUrl: string;
    cocoonEnabled: boolean;
    adminIds?: number[];
    communityChat?: number;
}
export declare class TelegramChannel {
    private bot;
    private router;
    private guardian;
    private config;
    /** Authenticated API call to Go backend */
    private apiCall;
    constructor(config: TelegramConfig);
    private setupCommands;
    private lang;
    private mainKeyboard;
    private setupHandlers;
    private handleSmartMixMenu;
    /** Handle deep link from monitor: sponsor-{signalId}-{starsCost} */
    private handleSponsorDeepLink;
    private handleBalance;
    private handleTopUp;
    private handleWallet;
    private handleLinkWallet;
    private handleEarn;
    private sendHelp;
    start(): Promise<void>;
    stop(): Promise<void>;
    private markdownToTelegramHtml;
    private escapeHtml;
    private sendFormattedReply;
}
//# sourceMappingURL=telegram.d.ts.map