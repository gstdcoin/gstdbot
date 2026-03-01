/**
 * GSTD Bot — Entry Point
 * 
 * Starts the Omega Gateway + configured channels
 */

import { OmegaGateway } from './gateway/server.js';
import { TelegramChannel } from './channels/telegram.js';

async function main(): Promise<void> {
    const gateway = new OmegaGateway({
        apiPort: parseInt(process.env.GSTD_API_PORT || '8080'),
        swarmUrl: process.env.GSTD_SWARM_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
        cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
        sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
    });

    await gateway.start();

    // Start Telegram channel if configured
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new TelegramChannel({
            botToken: telegramToken,
            swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
            cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
            adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').filter(Boolean).map(Number),
            communityChat: process.env.TELEGRAM_COMMUNITY_CHAT ? parseInt(process.env.TELEGRAM_COMMUNITY_CHAT) : undefined,
        });
        await telegram.start();
    } else {
        console.log('[Main] No TELEGRAM_BOT_TOKEN — Telegram channel disabled');
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n[Main] Shutting down...');
        await gateway.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('[Main] Fatal error:', err);
    process.exit(1);
});
