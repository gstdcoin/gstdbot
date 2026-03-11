"use strict";
/**
 * GSTD Node OS — App Manager
 *
 * Docker-based application management (77 apps, 11 Premium):
 * - Install/Remove apps from GSTD App Registry
 * - Manage app lifecycle (start/stop/restart)
 * - App manifest format (gstd-app.yml)
 * - Built-in apps: Chat, Monitor, Files
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppManager = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const server_js_1 = require("../gateway/server.js");
// ─── Built-in Apps Registry ─────────────────────────────────────
const BUILTIN_APPS = [
    // ═══ AI — Core Intelligence (6 apps) ═══
    {
        id: 'gstd-chat',
        name: 'Sovereign AI Chat',
        version: '2.0.0',
        description: 'Multi-model AI chat with SmartMix consensus. 8 models, streaming, markdown, code execution. Your private ChatGPT.',
        icon: '💬',
        author: 'GSTD Team',
        category: 'ai',
        port: 3000,
        gstd_cost: 0,
    },
    {
        id: 'gstd-coder',
        name: 'AI Code Studio',
        version: '1.0.0',
        description: 'AI-powered code generation, debugging, and review. Supports 50+ languages. Uses swarm consensus for better results.',
        icon: '👨‍💻',
        author: 'GSTD Team',
        category: 'ai',
        port: 3010,
        gstd_cost: 0,
    },
    {
        id: 'gstd-image-gen',
        name: 'AI Image Studio',
        version: '1.0.0',
        description: 'Generate and edit images with AI. Text-to-image, style transfer, upscaling. Powered by swarm GPU sharing.',
        icon: '🎨',
        author: 'GSTD Team',
        category: 'ai',
        port: 3011,
        gstd_cost: 0,
    },
    {
        id: 'gstd-translator',
        name: 'AI Translator',
        version: '1.0.0',
        description: 'Real-time text and document translation between 100+ languages. Private — no data leaves your node.',
        icon: '🌍',
        author: 'GSTD Team',
        category: 'ai',
        port: 3012,
        gstd_cost: 0,
    },
    {
        id: 'gstd-search',
        name: 'Sovereign Search',
        version: '1.0.0',
        description: 'AI-powered web search engine. Private, ad-free, unbiased. Results enhanced by collective swarm memory.',
        icon: '🔍',
        author: 'GSTD Team',
        category: 'ai',
        port: 3013,
        gstd_cost: 0,
    },
    {
        id: 'gstd-voice',
        name: 'Voice Assistant',
        version: '1.0.0',
        description: 'Speech-to-text and text-to-speech. Talk to your AI, dictate notes, voice commands for your node.',
        icon: '🎙️',
        author: 'GSTD Team',
        category: 'ai',
        port: 3014,
        gstd_cost: 0,
    },
    // ═══ Tools — Everyday Productivity (10 apps) ═══
    {
        id: 'gstd-notes',
        name: 'Smart Notes',
        version: '1.0.0',
        description: 'AI-enhanced notes and documents. Markdown, auto-summarization, smart search, tag suggestions. Synced across your devices.',
        icon: '📝',
        author: 'GSTD Team',
        category: 'tools',
        port: 3020,
        gstd_cost: 0,
    },
    {
        id: 'gstd-tasks',
        name: 'AI Task Manager',
        version: '1.0.0',
        description: 'Smart to-do lists and project boards. AI auto-prioritizes, suggests deadlines, and breaks tasks into subtasks.',
        icon: '✅',
        author: 'GSTD Team',
        category: 'tools',
        port: 3021,
        gstd_cost: 0,
    },
    {
        id: 'gstd-calendar',
        name: 'Calendar',
        version: '1.0.0',
        description: 'Private calendar with AI scheduling assistant. Natural language events, smart reminders, timezone sync.',
        icon: '📅',
        author: 'GSTD Team',
        category: 'tools',
        port: 3022,
        gstd_cost: 0,
    },
    {
        id: 'gstd-files',
        name: 'File Manager',
        version: '1.0.0',
        description: 'Local file manager with swarm sharing. Upload, organize, and share files across your node network.',
        icon: '📁',
        author: 'GSTD Team',
        category: 'tools',
        port: 3002,
        gstd_cost: 0,
    },
    {
        id: 'gstd-passwords',
        name: 'Password Vault',
        version: '1.0.0',
        description: 'Self-hosted password manager. End-to-end encrypted, AI password generator, breach detection alerts.',
        icon: '🔐',
        author: 'GSTD Team',
        category: 'tools',
        port: 3023,
        gstd_cost: 0,
    },
    {
        id: 'gstd-email',
        name: 'AI Mail Assistant',
        version: '1.0.0',
        description: 'Smart email composition and management. AI writes replies, summarizes threads, and prioritizes inbox.',
        icon: '📧',
        author: 'GSTD Team',
        category: 'tools',
        port: 3024,
        gstd_cost: 0,
    },
    {
        id: 'gstd-writer',
        name: 'AI Writer',
        version: '1.0.0',
        description: 'Professional content creation. Blog posts, reports, stories, social media. Multiple AI models for different styles.',
        icon: '✍️',
        author: 'GSTD Team',
        category: 'tools',
        port: 3025,
        gstd_cost: 0,
    },
    {
        id: 'gstd-pdf',
        name: 'PDF Studio',
        version: '1.0.0',
        description: 'View, create, merge, and convert PDFs. AI-powered OCR, text extraction, and document summarization.',
        icon: '📄',
        author: 'GSTD Team',
        category: 'tools',
        port: 3026,
        gstd_cost: 0,
    },
    {
        id: 'gstd-spreadsheet',
        name: 'Spreadsheet',
        version: '1.0.0',
        description: 'Collaborative spreadsheets with AI formula assistant. Data analysis, charts, pivot tables. Excel/CSV import/export.',
        icon: '📊',
        author: 'GSTD Team',
        category: 'tools',
        port: 3027,
        gstd_cost: 0,
    },
    {
        id: 'gstd-presentations',
        name: 'Presentations',
        version: '1.0.0',
        description: 'Create stunning presentations with AI. Auto-design slides, content suggestions, speaker notes from bullet points.',
        icon: '📺',
        author: 'GSTD Team',
        category: 'tools',
        port: 3028,
        gstd_cost: 0,
    },
    // ═══ Finance — Wealth & Crypto (4 apps) ═══
    {
        id: 'gstd-wallet',
        name: 'Wallet & Staking',
        version: '2.0.0',
        description: 'Full GSTD/TON wallet with earnings tracker, staking (12% APY), transaction history, and auto-compound.',
        icon: '💰',
        author: 'GSTD Team',
        category: 'finance',
        port: 3003,
        gstd_cost: 0,
    },
    {
        id: 'gstd-defi',
        name: 'DeFi Dashboard',
        version: '1.0.0',
        description: 'Monitor DeFi positions across TON, Ethereum, and BSC. Track yields, impermanent loss, and swap opportunities.',
        icon: '📊',
        author: 'GSTD Team',
        category: 'finance',
        port: 3030,
        gstd_cost: 0,
    },
    {
        id: 'gstd-portfolio',
        name: 'Portfolio Tracker',
        version: '1.0.0',
        description: 'Track crypto and traditional investments. AI market analysis, price alerts, and portfolio rebalancing suggestions.',
        icon: '📈',
        author: 'GSTD Team',
        category: 'finance',
        port: 3031,
        gstd_cost: 0,
    },
    {
        id: 'gstd-dex',
        name: 'Swap Terminal',
        version: '1.0.0',
        description: 'Decentralized token swap aggregator. Best rates across DEXs. AI-powered slippage protection and MEV defense.',
        icon: '🔄',
        author: 'GSTD Team',
        category: 'finance',
        port: 3032,
        gstd_cost: 0,
    },
    // ═══ Media — Content & Entertainment (6 apps) ═══
    {
        id: 'gstd-photos',
        name: 'Photo Gallery',
        version: '1.0.0',
        description: 'Self-hosted photo backup and gallery. AI auto-tagging, face recognition, smart albums. Google Photos alternative.',
        icon: '📸',
        author: 'GSTD Team',
        category: 'media',
        port: 3040,
        gstd_cost: 0,
    },
    {
        id: 'gstd-music',
        name: 'Music Player',
        version: '1.0.0',
        description: 'Personal music streaming server. Upload your library, create playlists, stream from any device. Spotify alternative.',
        icon: '🎵',
        author: 'GSTD Team',
        category: 'media',
        port: 3041,
        gstd_cost: 0,
    },
    {
        id: 'gstd-reader',
        name: 'AI Reader',
        version: '1.0.0',
        description: 'eBook reader and RSS feed aggregator. AI summarizes articles, highlights key points, text-to-speech.',
        icon: '📖',
        author: 'GSTD Team',
        category: 'media',
        port: 3042,
        gstd_cost: 0,
    },
    {
        id: 'gstd-downloader',
        name: 'Media Downloader',
        version: '1.0.0',
        description: 'Download videos and audio from 1000+ sites. Queue management, format conversion, metadata extraction.',
        icon: '⬇️',
        author: 'GSTD Team',
        category: 'media',
        port: 3043,
        gstd_cost: 0,
    },
    {
        id: 'gstd-podcast',
        name: 'Podcast Studio',
        version: '1.0.0',
        description: 'Record, edit, and publish podcasts. AI noise removal, auto-transcription, chapter markers, RSS feed generation.',
        icon: '🎧',
        author: 'GSTD Team',
        category: 'media',
        port: 3044,
        gstd_cost: 0,
    },
    {
        id: 'gstd-video',
        name: 'Video Editor',
        version: '1.0.0',
        description: 'Simple web-based video editor. Cut, merge, add subtitles, AI enhance. Export to multiple formats.',
        icon: '🎬',
        author: 'GSTD Team',
        category: 'media',
        port: 3045,
        gstd_cost: 0,
    },
    // ═══ Cloud & Storage (6 apps) ═══
    {
        id: 'gstd-cloud',
        name: 'Cloud Drive',
        version: '1.0.0',
        description: 'Self-hosted cloud storage like Google Drive. Auto-sync across devices, share files, version history. 100% private.',
        icon: '☁️',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3070,
        gstd_cost: 0,
    },
    {
        id: 'gstd-backup',
        name: 'Backup Manager',
        version: '1.0.0',
        description: 'Automated encrypted backups. Schedule backups to other nodes, S3, or local drives. Cross-node redundancy.',
        icon: '💾',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3071,
        gstd_cost: 0,
    },
    {
        id: 'gstd-sync',
        name: 'File Sync',
        version: '1.0.0',
        description: 'Real-time file synchronization across all your devices. P2P direct transfer, conflict resolution, selective sync.',
        icon: '🔄',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3072,
        gstd_cost: 0,
    },
    {
        id: 'gstd-git',
        name: 'Git Server',
        version: '1.0.0',
        description: 'Private Git repository hosting. Web UI, pull requests, CI/CD pipelines. Your own GitHub/Gitea instance.',
        icon: '🔧',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3073,
        gstd_cost: 0,
    },
    {
        id: 'gstd-s3',
        name: 'Object Storage',
        version: '1.0.0',
        description: 'S3-compatible object storage API. Store and serve files for web apps, backups, and media. MinIO-based.',
        icon: '🗄️',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3074,
        gstd_cost: 0,
    },
    {
        id: 'gstd-database',
        name: 'Database Manager',
        version: '1.0.0',
        description: 'Visual database manager. Create, query, and manage SQL/NoSQL databases. Import/export CSV, JSON, Excel.',
        icon: '🗃️',
        author: 'GSTD Team',
        category: 'cloud',
        port: 3075,
        gstd_cost: 0,
    },
    // ═══ Communication (4 apps) ═══
    {
        id: 'gstd-messenger',
        name: 'Encrypted Messenger',
        version: '1.0.0',
        description: 'Decentralized P2P messaging. End-to-end encrypted, no central server. Group chats, file sharing, voice messages.',
        icon: '💬',
        author: 'GSTD Team',
        category: 'communication',
        port: 3080,
        gstd_cost: 0,
    },
    {
        id: 'gstd-videocall',
        name: 'Video Conferencing',
        version: '1.0.0',
        description: 'Self-hosted video calls and meetings. WebRTC-based, E2E encrypted, screen sharing, recording. Zoom alternative.',
        icon: '📹',
        author: 'GSTD Team',
        category: 'communication',
        port: 3081,
        gstd_cost: 0,
    },
    {
        id: 'gstd-mailserver',
        name: 'Email Server',
        version: '1.0.0',
        description: 'Full self-hosted email server. SMTP/IMAP with webmail UI, AI spam filtering, custom domains. Own your inbox.',
        icon: '📬',
        author: 'GSTD Team',
        category: 'communication',
        port: 3082,
        gstd_cost: 0,
    },
    {
        id: 'gstd-contacts',
        name: 'Contacts',
        version: '1.0.0',
        description: 'Contact management with CardDAV sync. AI deduplication, social enrichment, birthday reminders, contact groups.',
        icon: '👥',
        author: 'GSTD Team',
        category: 'communication',
        port: 3083,
        gstd_cost: 0,
    },
    // ═══ Network & Privacy (3 apps) ═══
    {
        id: 'gstd-vpn',
        name: 'VPN Gateway',
        version: '1.0.0',
        description: 'Built-in WireGuard VPN server. Access your node from anywhere. Encrypted tunnel, QR code config for phones.',
        icon: '🛡️',
        author: 'GSTD Team',
        category: 'network',
        port: 3050,
        gstd_cost: 0,
    },
    {
        id: 'gstd-adblock',
        name: 'Ad Blocker',
        version: '1.0.0',
        description: 'Network-wide ad and tracker blocking. DNS-level filtering for all devices on your network. PiHole alternative.',
        icon: '🚫',
        author: 'GSTD Team',
        category: 'network',
        port: 3051,
        gstd_cost: 0,
    },
    {
        id: 'gstd-monitor',
        name: 'Network Monitor',
        version: '1.0.0',
        description: 'Real-time monitoring of the GSTD swarm network. Node stats, tasks, earnings, peer connections, global map.',
        icon: '🌐',
        author: 'GSTD Team',
        category: 'network',
        port: 3001,
        gstd_cost: 0,
    },
    // ═══ Security (6 apps) ═══
    {
        id: 'gstd-firewall',
        name: 'Firewall Manager',
        version: '1.0.0',
        description: 'Visual firewall rules manager. One-click port opening/closing, geo-blocking, DDoS protection, traffic analysis.',
        icon: '🧱',
        author: 'GSTD Team',
        category: 'security',
        port: 3090,
        gstd_cost: 0,
    },
    {
        id: 'gstd-ids',
        name: 'Intrusion Detection',
        version: '1.0.0',
        description: 'AI-powered threat detection. Monitors login attempts, network anomalies, file changes. Real-time alerts.',
        icon: '🔔',
        author: 'GSTD Team',
        category: 'security',
        port: 3091,
        gstd_cost: 0,
    },
    {
        id: 'gstd-ssl',
        name: 'SSL Manager',
        version: '1.0.0',
        description: 'Automatic SSL certificate management. Let\'s Encrypt auto-renewal, wildcard support, reverse proxy config.',
        icon: '🔒',
        author: 'GSTD Team',
        category: 'security',
        port: 3092,
        gstd_cost: 0,
    },
    {
        id: 'gstd-2fa',
        name: '2FA Authenticator',
        version: '1.0.0',
        description: 'Self-hosted TOTP authenticator. Replaces Google Authenticator — your codes stay on your node, encrypted backups.',
        icon: '🔑',
        author: 'GSTD Team',
        category: 'security',
        port: 3093,
        gstd_cost: 0,
    },
    {
        id: 'gstd-audit',
        name: 'Audit Logger',
        version: '1.0.0',
        description: 'Immutable security audit trail. Logs all access, changes, logins. Tamper-proof with hash chain verification.',
        icon: '📋',
        author: 'GSTD Team',
        category: 'security',
        port: 3094,
        gstd_cost: 0,
    },
    {
        id: 'gstd-hardening',
        name: 'Node Hardening',
        version: '1.0.0',
        description: 'One-click security hardening for hosted nodes. CIS benchmarks, SSH hardening, auto-updates, vulnerability scan.',
        icon: '🛡️',
        author: 'GSTD Team',
        category: 'security',
        port: 3095,
        gstd_cost: 0,
    },
    // ═══ System — Node Management (5 apps) ═══
    {
        id: 'gstd-knowledge',
        name: 'Knowledge Base',
        version: '1.0.0',
        description: 'Browse and search the collective memory. Verify facts, contribute knowledge to the swarm brain.',
        icon: '🧠',
        author: 'GSTD Team',
        category: 'system',
        port: 3004,
        gstd_cost: 0,
    },
    {
        id: 'gstd-automation',
        name: 'AI Automations',
        version: '1.0.0',
        description: 'Visual workflow builder. Create AI-powered automations: schedule tasks, trigger actions, connect apps. Your personal IFTTT.',
        icon: '⚡',
        author: 'GSTD Team',
        category: 'system',
        port: 3060,
        gstd_cost: 0,
    },
    {
        id: 'gstd-terminal',
        name: 'Web Terminal',
        version: '1.0.0',
        description: 'Browser-based terminal with AI shell assistant. Natural language commands, auto-completion, error explanation.',
        icon: '🖥️',
        author: 'GSTD Team',
        category: 'system',
        port: 3061,
        gstd_cost: 0,
    },
    {
        id: 'gstd-cron',
        name: 'Task Scheduler',
        version: '1.0.0',
        description: 'Visual cron job manager. Schedule scripts, backups, updates. Natural language scheduling with AI ("every Monday at 9am").',
        icon: '⏰',
        author: 'GSTD Team',
        category: 'system',
        port: 3062,
        gstd_cost: 0,
    },
    {
        id: 'gstd-logs',
        name: 'Log Viewer',
        version: '1.0.0',
        description: 'Centralized log viewer for all apps and system services. Search, filter, alerts on errors. AI diagnostics.',
        icon: '📜',
        author: 'GSTD Team',
        category: 'system',
        port: 3063,
        gstd_cost: 0,
    },
    // ═══ Web & Browsers (4 apps) ═══
    {
        id: 'gstd-chromium',
        name: 'Chromium Browser',
        version: '1.0.0',
        description: 'Full Chromium browser accessible via web. Browse the internet from your node. All traffic through your VPN/proxy.',
        icon: '🌐',
        author: 'GSTD Team',
        category: 'web',
        port: 3100,
        gstd_cost: 0,
        premium: true,
        docker: { image: 'kasmweb/chromium:1.15.0', ports: ['3100:6901'], volumes: ['chromium_data:/home/kasm-user'], environment: {} },
    },
    {
        id: 'gstd-firefox',
        name: 'Firefox Browser',
        version: '1.0.0',
        description: 'Privacy-focused Firefox browser in your node. Installed extensions: uBlock, HTTPS Everywhere. Bookmarks synced.',
        icon: '🦊',
        author: 'GSTD Team',
        category: 'web',
        port: 3101,
        gstd_cost: 0,
        premium: true,
        docker: { image: 'kasmweb/firefox:1.15.0', ports: ['3101:6901'], volumes: ['firefox_data:/home/kasm-user'], environment: {} },
    },
    {
        id: 'gstd-tor',
        name: 'Tor Browser',
        version: '1.0.0',
        description: 'Anonymous Tor Browser via node. Access .onion sites, bypass censorship. Your IP never exposed. Reset identity in 1 click.',
        icon: '🧅',
        author: 'GSTD Team',
        category: 'web',
        port: 3102,
        gstd_cost: 0,
    },
    {
        id: 'gstd-proxy',
        name: 'Web Proxy',
        version: '1.0.0',
        description: 'HTTP/SOCKS5 proxy server. Route any device traffic through your node. Block ads, cache pages, parental controls.',
        icon: '🔗',
        author: 'GSTD Team',
        category: 'web',
        port: 3103,
        gstd_cost: 0,
    },
    // ═══ Social Media & Messengers (8 apps) ═══
    {
        id: 'gstd-telegram-client',
        name: 'Telegram Client',
        version: '1.0.0',
        description: 'Full Telegram Web client on your node. All messages stored locally, no cloud dependency. Multi-account support.',
        icon: '✈️',
        author: 'GSTD Team',
        category: 'communication',
        port: 3110,
        gstd_cost: 0,
        premium: true,
    },
    {
        id: 'gstd-discord',
        name: 'Discord Client',
        version: '1.0.0',
        description: 'Web-based Discord client. Run bots, manage servers, voice chat. Runs on your node for 24/7 uptime.',
        icon: '💜',
        author: 'GSTD Team',
        category: 'communication',
        port: 3111,
        gstd_cost: 0,
        premium: true,
    },
    {
        id: 'gstd-matrix',
        name: 'Matrix Chat (Element)',
        version: '1.0.0',
        description: 'Decentralized Matrix chat server + Element web client. Federated, encrypted, bridges to Telegram/Discord/Slack.',
        icon: '🟢',
        author: 'GSTD Team',
        category: 'communication',
        port: 3112,
        gstd_cost: 0,
        docker: { image: 'vectorim/element-web:latest', ports: ['3112:80'], volumes: ['element_data:/app/config'], environment: {} },
    },
    {
        id: 'gstd-mastodon',
        name: 'Mastodon Instance',
        version: '1.0.0',
        description: 'Your own Mastodon/Fediverse instance. Decentralized social media, no ads, own your social graph. Post from node.',
        icon: '🐘',
        author: 'GSTD Team',
        category: 'communication',
        port: 3113,
        gstd_cost: 0,
    },
    {
        id: 'gstd-whatsapp',
        name: 'WhatsApp Bridge',
        version: '1.0.0',
        description: 'WhatsApp Web bridge. Access WhatsApp from your node dashboard. Messages backed up locally, AI auto-reply options.',
        icon: '📱',
        author: 'GSTD Team',
        category: 'communication',
        port: 3114,
        gstd_cost: 0,
    },
    {
        id: 'gstd-xtwitter',
        name: 'X/Twitter Client',
        version: '1.0.0',
        description: 'Alternative X/Twitter client. Chronological feed, no ads, AI content filter. Schedule posts, analytics dashboard.',
        icon: '𝕏',
        author: 'GSTD Team',
        category: 'communication',
        port: 3115,
        gstd_cost: 0,
    },
    {
        id: 'gstd-reddit',
        name: 'Reddit Client',
        version: '1.0.0',
        description: 'Clean Reddit reader. No ads, old-style layout, AI summary of long threads, save posts offline. Multi-account.',
        icon: '🔴',
        author: 'GSTD Team',
        category: 'communication',
        port: 3116,
        gstd_cost: 0,
    },
    {
        id: 'gstd-rss',
        name: 'RSS Aggregator',
        version: '1.0.0',
        description: 'Self-hosted RSS/Atom feed reader. Follow any website, YouTube, podcast. AI categorization & daily digest.',
        icon: '📡',
        author: 'GSTD Team',
        category: 'communication',
        port: 3117,
        gstd_cost: 0,
        docker: { image: 'miniflux/miniflux:latest', ports: ['3117:8080'], volumes: ['miniflux_data:/data'], environment: { DATABASE_URL: 'sqlite:///data/miniflux.db' } },
    },
    // ═══ AI & OpenClaw (4 apps) ═══
    {
        id: 'openclaw',
        name: 'OpenClaw AI Gateway',
        version: '2.0.0',
        description: 'Full OpenClaw installation. Multi-provider AI gateway: OpenAI, Anthropic, Groq, Mistral, Gemini. All queries feed collective memory for swarm training.',
        icon: '🦞',
        author: 'OpenClaw',
        category: 'ai',
        port: 3120,
        gstd_cost: 0,
        premium: true,
        docker: { image: 'ghcr.io/lobehub/lobe-chat:latest', ports: ['3120:3210'], volumes: ['openclaw_data:/root/.lobe-chat'], environment: {} },
    },
    {
        id: 'gstd-aihub',
        name: 'AI Model Hub',
        version: '1.0.0',
        description: 'Connect any AI API: OpenAI, Claude, Gemini, Groq, Mistral, Perplexity. Unified interface, all responses stored in collective memory for swarm learning.',
        icon: '🤖',
        author: 'GSTD Team',
        category: 'ai',
        port: 3121,
        gstd_cost: 0,
        premium: true,
    },
    {
        id: 'gstd-ollama',
        name: 'Ollama (Local LLM)',
        version: '1.0.0',
        description: 'Run AI models locally on your node. Llama 3, Mistral, Phi-3, Gemma. No API keys needed. GPU accelerated if available.',
        icon: '🦙',
        author: 'GSTD Team',
        category: 'ai',
        port: 3122,
        gstd_cost: 0,
        premium: true,
        docker: { image: 'ollama/ollama:latest', ports: ['3122:11434'], volumes: ['ollama_models:/root/.ollama'], environment: {} },
    },
    {
        id: 'gstd-stable-diffusion',
        name: 'Stable Diffusion',
        version: '1.0.0',
        description: 'Local image generation with Stable Diffusion. txt2img, img2img, ControlNet. Requires GPU. Generated images stay private.',
        icon: '🖼️',
        author: 'GSTD Team',
        category: 'ai',
        port: 3123,
        gstd_cost: 0,
        premium: true,
    },
    // ═══ DeFi, Wallets & TON Services (8 apps) ═══
    {
        id: 'gstd-ton-wallet',
        name: 'TON Wallet',
        version: '1.0.0',
        description: 'Full TON wallet with GSTD token support. Send/receive TON & jettons, view transaction history, stake TON. WalletV4 compatible.',
        icon: '💎',
        author: 'GSTD Team',
        category: 'defi',
        port: 3130,
        gstd_cost: 0,
    },
    {
        id: 'gstd-tonkeeper',
        name: 'Tonkeeper Web',
        version: '1.0.0',
        description: 'Tonkeeper wallet web interface. Manage TON, jettons, NFTs. Connect to dApps. Full DeFi access from your node.',
        icon: '🔷',
        author: 'TON Foundation',
        category: 'defi',
        port: 3131,
        gstd_cost: 0,
        premium: true,
    },
    {
        id: 'gstd-metamask',
        name: 'MetaMask Snap',
        version: '1.0.0',
        description: 'MetaMask-compatible wallet for EVM chains. Manage ETH, BSC, Polygon, Arbitrum tokens. Bridge assets to TON.',
        icon: '🦊',
        author: 'GSTD Team',
        category: 'defi',
        port: 3132,
        gstd_cost: 0,
    },
    {
        id: 'gstd-swap',
        name: 'GSTD Swap',
        version: '1.0.0',
        description: 'Instant token swap: TON↔GSTD, GSTD↔USDT. Best rates from Ston.fi and DeDust aggregation. Buy GSTD directly.',
        icon: '🔄',
        author: 'GSTD Team',
        category: 'defi',
        port: 3133,
        gstd_cost: 0,
        premium: true,
    },
    {
        id: 'gstd-stonfi',
        name: 'Ston.fi DEX',
        version: '1.0.0',
        description: 'Decentralized exchange on TON. Swap tokens, provide liquidity, farm yields. Trade GSTD/TON pair.',
        icon: '💧',
        author: 'Ston.fi',
        category: 'defi',
        port: 3134,
        gstd_cost: 0,
    },
    {
        id: 'gstd-dedust',
        name: 'DeDust DEX',
        version: '1.0.0',
        description: 'DeDust.io decentralized exchange. Swap TON tokens, stable pools, concentrated liquidity. Access from your node.',
        icon: '🌊',
        author: 'DeDust',
        category: 'defi',
        port: 3135,
        gstd_cost: 0,
    },
    {
        id: 'gstd-buy-crypto',
        name: 'Buy Crypto',
        version: '1.0.0',
        description: 'Buy TON and GSTD with fiat currency. Card payments via Mercuryo, Transak, RAMP. Direct to your node wallet.',
        icon: '💳',
        author: 'GSTD Team',
        category: 'defi',
        port: 3136,
        gstd_cost: 0,
    },
    {
        id: 'gstd-portfolio',
        name: 'Portfolio Tracker',
        version: '1.0.0',
        description: 'Track all your crypto holdings across TON, ETH, BSC chains. Real-time prices, P&L charts, tax reports. Multi-wallet.',
        icon: '📊',
        author: 'GSTD Team',
        category: 'defi',
        port: 3137,
        gstd_cost: 0,
    },
    // ═══ TON Infrastructure (3 apps) ═══
    {
        id: 'gstd-liteserver',
        name: 'TON Liteserver',
        version: '1.0.0',
        description: 'Run a TON Liteserver node. Serve blockchain data, validate transactions. Earn TON as infrastructure provider. Requires 16GB+ RAM.',
        icon: '🏗️',
        author: 'TON Foundation',
        category: 'network',
        port: 3140,
        gstd_cost: 0,
        premium: true,
        requires: ['docker', 'ram:16384'],
        docker: { image: 'tonlabs/ton-node:latest', ports: ['3140:3030', '43679:43679/udp'], volumes: ['ton_node_data:/var/ton-work'], environment: { TON_GLOBAL_CONFIG: 'https://ton.org/global-config.json' } },
    },
    {
        id: 'gstd-ton-explorer',
        name: 'TON Explorer',
        version: '1.0.0',
        description: 'Local TON blockchain explorer. Browse blocks, transactions, smart contracts. No external API dependency. Private.',
        icon: '🔍',
        author: 'GSTD Team',
        category: 'network',
        port: 3141,
        gstd_cost: 0,
    },
    {
        id: 'gstd-ton-dns',
        name: 'TON DNS Manager',
        version: '1.0.0',
        description: 'Manage TON DNS domains (.ton). Register, renew, point to your node. Decentralized naming for your services.',
        icon: '🌐',
        author: 'GSTD Team',
        category: 'network',
        port: 3142,
        gstd_cost: 0,
    },
];
// ─── Community App Registry (fetched from platform) ─────────────
const REGISTRY_URL = 'https://app.gstdtoken.com/api/v1/apps/registry';
// ─── App Manager ────────────────────────────────────────────────
class AppManager {
    appsDir;
    installed = new Map();
    stateFile;
    constructor(dataDir) {
        this.appsDir = dataDir || (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot', 'apps');
        this.stateFile = (0, path_1.join)(this.appsDir, 'installed.json');
        if (!(0, fs_1.existsSync)(this.appsDir)) {
            (0, fs_1.mkdirSync)(this.appsDir, { recursive: true });
        }
    }
    async init() {
        // Load installed apps state
        if ((0, fs_1.existsSync)(this.stateFile)) {
            try {
                const data = JSON.parse((0, fs_1.readFileSync)(this.stateFile, 'utf-8'));
                for (const app of data) {
                    this.installed.set(app.manifest.id, app);
                }
            }
            catch { }
        }
        console.log(`    Apps: ${this.installed.size} installed, ${BUILTIN_APPS.length} built-in available`);
    }
    // ─── List ────────────────────────────────────────────────────
    getInstalled() {
        return Array.from(this.installed.values());
    }
    getAvailable() {
        return BUILTIN_APPS.filter(app => !this.installed.has(app.id));
    }
    async getRegistry() {
        try {
            const resp = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const data = await resp.json();
                return data.apps || [];
            }
        }
        catch { }
        return BUILTIN_APPS;
    }
    // ─── Install ─────────────────────────────────────────────────
    async install(appId) {
        if (this.installed.has(appId)) {
            (0, server_js_1.logActivity)(`App ${appId} already installed`, 'warn');
            return false;
        }
        // Find manifest
        const manifest = BUILTIN_APPS.find(a => a.id === appId);
        if (!manifest) {
            (0, server_js_1.logActivity)(`App ${appId} not found in registry`, 'error');
            return false;
        }
        (0, server_js_1.logActivity)(`Installing app: ${manifest.name}...`, 'info');
        const installedApp = {
            manifest,
            installedAt: new Date().toISOString(),
            status: 'installing',
        };
        this.installed.set(appId, installedApp);
        // Create app data directory
        const appDir = (0, path_1.join)(this.appsDir, appId);
        if (!(0, fs_1.existsSync)(appDir)) {
            (0, fs_1.mkdirSync)(appDir, { recursive: true });
        }
        // Docker-based install
        if (manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker pull ${manifest.docker.image}`, {
                    encoding: 'utf-8',
                    timeout: 120_000,
                });
                installedApp.status = 'stopped';
                (0, server_js_1.logActivity)(`App ${manifest.name} installed ✓`, 'success');
            }
            catch (e) {
                installedApp.status = 'error';
                (0, server_js_1.logActivity)(`App ${manifest.name} install failed: ${e.message}`, 'error');
                return false;
            }
        }
        else {
            // Script-based or built-in
            installedApp.status = 'stopped';
            (0, server_js_1.logActivity)(`App ${manifest.name} installed ✓`, 'success');
        }
        this.saveState();
        return true;
    }
    // ─── Uninstall ───────────────────────────────────────────────
    async uninstall(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        // Stop first
        await this.stop(appId);
        // Remove data
        const appDir = (0, path_1.join)(this.appsDir, appId);
        if ((0, fs_1.existsSync)(appDir)) {
            try {
                (0, fs_1.rmSync)(appDir, { recursive: true, force: true });
            }
            catch { }
        }
        // Remove docker container/image
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker rm -f gstd-${appId} 2>/dev/null; docker rmi ${app.manifest.docker.image} 2>/dev/null`, {
                    encoding: 'utf-8',
                    timeout: 30_000,
                });
            }
            catch { }
        }
        this.installed.delete(appId);
        this.saveState();
        (0, server_js_1.logActivity)(`App ${app.manifest.name} uninstalled`, 'warn');
        return true;
    }
    // ─── Start / Stop ────────────────────────────────────────────
    async start(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                const m = app.manifest.docker;
                const ports = m.ports.map(p => `-p ${p}`).join(' ');
                const volumes = m.volumes.map(v => `-v ${v}`).join(' ');
                const envs = Object.entries(m.environment || {}).map(([k, v]) => `-e ${k}=${v}`).join(' ');
                execSync(`docker rm -f gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
                execSync(`docker run -d --name gstd-${appId} ${ports} ${volumes} ${envs} --restart unless-stopped ${m.image}`, { encoding: 'utf-8', timeout: 30_000 });
                app.status = 'running';
                app.url = `http://localhost:${app.manifest.port}`;
                this.saveState();
                (0, server_js_1.logActivity)(`App ${app.manifest.name} started on :${app.manifest.port}`, 'success');
                return true;
            }
            catch (e) {
                app.status = 'error';
                (0, server_js_1.logActivity)(`App ${app.manifest.name} start failed: ${e.message}`, 'error');
                return false;
            }
        }
        // Built-in apps: served by the gateway server at /apps/{appId}
        app.status = 'running';
        app.url = `/apps/${appId}`;
        this.saveState();
        (0, server_js_1.logActivity)(`App ${app.manifest.name} started at /apps/${appId}`, 'success');
        return true;
    }
    async stop(appId) {
        const app = this.installed.get(appId);
        if (!app)
            return false;
        if (app.manifest.docker) {
            try {
                const { execSync } = require('child_process');
                execSync(`docker stop gstd-${appId} 2>/dev/null || true`, { encoding: 'utf-8' });
            }
            catch { }
        }
        app.status = 'stopped';
        app.url = undefined;
        this.saveState();
        (0, server_js_1.logActivity)(`App ${app.manifest.name} stopped`, 'info');
        return true;
    }
    async restart(appId) {
        await this.stop(appId);
        return this.start(appId);
    }
    // ─── State Persistence ───────────────────────────────────────
    saveState() {
        try {
            (0, fs_1.writeFileSync)(this.stateFile, JSON.stringify(Array.from(this.installed.values()), null, 2));
        }
        catch { }
    }
}
exports.AppManager = AppManager;
//# sourceMappingURL=manager.js.map