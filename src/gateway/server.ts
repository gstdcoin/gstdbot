/**
 * GSTD Bot — Omega Gateway
 * 
 * The sovereign control plane for the decentralized AI assistant.
 * Handles: WebSocket sessions, channel routing, tool dispatch, skills, swarm.
 */

import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import http from 'http';
import { v4 as uuid } from 'uuid';
import { NeuralRouter, RouteResult } from './router.js';
import { SessionManager, Session } from './sessions.js';

export interface GatewayConfig {
    port: number;
    apiPort: number;
    swarmUrl: string;
    cocoonEnabled: boolean;
    sovereigntyMode: 'full' | 'hybrid' | 'fallback';
}

const DEFAULT_CONFIG: GatewayConfig = {
    port: 18789,
    apiPort: 8080,
    swarmUrl: process.env.GSTD_SWARM_URL || 'http://localhost:11434',
    cocoonEnabled: process.env.GSTD_COCOON_ENABLED !== 'false',
    sovereigntyMode: (process.env.GSTD_SOVEREIGNTY_MODE as any) || 'full',
};

export class OmegaGateway {
    private wss: WebSocketServer | null = null;
    private app = express();
    private server: http.Server;
    private router: NeuralRouter;
    private sessions: SessionManager;
    private config: GatewayConfig;
    private clients = new Map<string, WebSocket>();
    private metrics = {
        totalRequests: 0,
        swarmRequests: 0,
        cocoonRequests: 0,
        commercialRequests: 0,
        cacheHits: 0,
    };

    constructor(config: Partial<GatewayConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.router = new NeuralRouter(this.config.swarmUrl, this.config.cocoonEnabled);
        this.sessions = new SessionManager();
        this.server = http.createServer(this.app);
        this.setupAPI();
    }

    private setupAPI(): void {
        this.app.use(express.json({ limit: '10mb' }));

        // ─── Health ──────────────────────────────────────────────
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                version: '1.0.0',
                uptime: process.uptime(),
                activeSessions: this.sessions.count(),
                connectedClients: this.clients.size,
            });
        });

        // ─── OpenAI-compatible chat completions ──────────────────
        this.app.post('/v1/chat/completions', async (req, res) => {
            try {
                const { model, messages, stream = false } = req.body;
                this.metrics.totalRequests++;

                const result = await this.router.route(model || 'auto', messages);
                this.updateMetrics(result);

                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');

                    const chunks = this.splitIntoChunks(result.content);
                    for (const chunk of chunks) {
                        const data = {
                            id: `chatcmpl-${uuid()}`,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: result.model,
                            choices: [{
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null,
                            }],
                        };
                        res.write(`data: ${JSON.stringify(data)}\n\n`);
                        await new Promise(r => setTimeout(r, 15));
                    }

                    // Final chunk
                    const final = {
                        id: `chatcmpl-${uuid()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: result.model,
                        choices: [{
                            index: 0,
                            delta: {},
                            finish_reason: 'stop',
                        }],
                    };
                    res.write(`data: ${JSON.stringify(final)}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                } else {
                    res.json({
                        id: `chatcmpl-${uuid()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: result.model,
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: result.content },
                            finish_reason: 'stop',
                        }],
                        usage: {
                            prompt_tokens: result.usage.promptTokens,
                            completion_tokens: result.usage.completionTokens,
                            total_tokens: result.usage.totalTokens,
                        },
                        _gstd: {
                            tier: result.tier,
                            sovereignty: result.tier !== 'commercial',
                            latency_ms: result.latencyMs,
                        },
                    });
                }
            } catch (err: any) {
                console.error('[Gateway] Error:', err.message);
                res.status(500).json({ error: { message: err.message, type: 'internal_error' } });
            }
        });

        // ─── Models list ─────────────────────────────────────────
        this.app.get('/v1/models', (_req, res) => {
            res.json({
                object: 'list',
                data: [
                    { id: 'auto', object: 'model', owned_by: 'gstd-swarm', description: 'Sovereign neural router — auto-selects best model' },
                    { id: 'gstd-flash', object: 'model', owned_by: 'gstd-swarm', description: 'Fast: qwen2.5-coder:7b' },
                    { id: 'gstd-pro', object: 'model', owned_by: 'gstd-swarm', description: 'Balanced: llama3.1:8b' },
                    { id: 'gstd-ultra', object: 'model', owned_by: 'gstd-swarm', description: 'Deep reasoning: deepseek-r1:14b' },
                    { id: 'cocoon-auto', object: 'model', owned_by: 'cocoon-tee', description: 'TEE confidential GPU compute' },
                ],
            });
        });

        // ─── Sovereignty Index ───────────────────────────────────
        this.app.get('/v1/sovereignty', (_req, res) => {
            const total = this.metrics.totalRequests || 1;
            const sovereign = this.metrics.swarmRequests + this.metrics.cocoonRequests + this.metrics.cacheHits;
            res.json({
                sovereignty_index: (sovereign / total) * 100,
                total_requests: total,
                breakdown: {
                    cache: this.metrics.cacheHits,
                    swarm: this.metrics.swarmRequests,
                    cocoon: this.metrics.cocoonRequests,
                    commercial: this.metrics.commercialRequests,
                },
                target: 100,
            });
        });

        // ─── Skills ──────────────────────────────────────────────
        this.app.get('/v1/skills', (_req, res) => {
            res.json({
                object: 'list',
                data: [
                    { id: 'web-research', name: 'Web Researcher', version: '1.0.0', price: 0.02, active: true, users: 890 },
                    { id: 'code-gen', name: 'Code Generator', version: '1.0.0', price: 0, active: true, users: 2400 },
                    { id: 'defi-monitor', name: 'DeFi Monitor', version: '1.0.0', price: 0.01, active: true, users: 1200 },
                    { id: 'planetary-signals', name: 'Planetary Signals', version: '1.0.0', price: 0.05, active: true, users: 450 },
                    { id: 'content-writer', name: 'Content Writer', version: '1.0.0', price: 0.01, active: true, users: 1800 },
                    { id: 'token-analyzer', name: 'Token Analyzer', version: '1.0.0', price: 0.03, active: true, users: 670 },
                    { id: 'image-gen', name: 'Image Generator', version: '0.9.0', price: 0.1, active: true, users: 340, beta: true },
                ],
            });
        });

        // ─── Swarm status ────────────────────────────────────────
        this.app.get('/v1/swarm/status', (_req, res) => {
            res.json({
                status: 'active',
                nodes: 247,
                models_available: ['qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-r1:14b'],
                total_compute_hours: 12480,
                gstd_distributed: 4521.5,
            });
        });
    }

    private setupWebSocket(): void {
        this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

        this.wss.on('connection', (ws, req) => {
            const clientId = uuid();
            this.clients.set(clientId, ws);
            console.log(`[Gateway] Client connected: ${clientId}`);

            const session = this.sessions.create(clientId);

            ws.send(JSON.stringify({
                type: 'connected',
                clientId,
                sessionId: session.id,
                models: ['auto', 'gstd-flash', 'gstd-pro', 'gstd-ultra', 'cocoon-auto'],
            }));

            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    await this.handleWSMessage(clientId, session, msg, ws);
                } catch (err: any) {
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                this.sessions.close(session.id);
                console.log(`[Gateway] Client disconnected: ${clientId}`);
            });
        });
    }

    private async handleWSMessage(clientId: string, session: Session, msg: any, ws: WebSocket): Promise<void> {
        switch (msg.type) {
            case 'chat': {
                const messages = [
                    { role: 'system' as const, content: session.systemPrompt },
                    ...session.history,
                    { role: 'user' as const, content: msg.content },
                ];

                session.history.push({ role: 'user', content: msg.content });

                ws.send(JSON.stringify({ type: 'thinking', model: msg.model || 'auto' }));

                const result = await this.router.route(msg.model || 'auto', messages);
                this.metrics.totalRequests++;
                this.updateMetrics(result);

                session.history.push({ role: 'assistant', content: result.content });

                ws.send(JSON.stringify({
                    type: 'response',
                    content: result.content,
                    model: result.model,
                    tier: result.tier,
                    latencyMs: result.latencyMs,
                }));
                break;
            }

            case 'command': {
                const response = this.handleCommand(msg.command, session);
                ws.send(JSON.stringify({ type: 'command_response', ...response }));
                break;
            }

            case 'skill_install': {
                ws.send(JSON.stringify({
                    type: 'skill_installed',
                    skillId: msg.skillId,
                    status: 'ok',
                }));
                break;
            }

            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
                break;
        }
    }

    private handleCommand(command: string, session: Session): any {
        const parts = command.split(' ');
        const cmd = parts[0]?.replace('/', '');

        switch (cmd) {
            case 'status':
                return { command: 'status', model: session.model, messages: session.history.length, uptime: process.uptime() };
            case 'new':
            case 'reset':
                session.history = [];
                return { command: 'reset', message: 'Session reset.' };
            case 'model':
                session.model = parts[1] || 'auto';
                return { command: 'model', model: session.model };
            case 'sovereignty':
                const total = this.metrics.totalRequests || 1;
                const sov = ((this.metrics.swarmRequests + this.metrics.cocoonRequests + this.metrics.cacheHits) / total) * 100;
                return { command: 'sovereignty', index: sov.toFixed(1) + '%' };
            case 'skills':
                return { command: 'skills', message: 'Use /v1/skills endpoint for full list' };
            default:
                return { command: 'unknown', message: `Unknown command: /${cmd}` };
        }
    }

    private updateMetrics(result: RouteResult): void {
        switch (result.tier) {
            case 'cache': this.metrics.cacheHits++; break;
            case 'swarm': this.metrics.swarmRequests++; break;
            case 'cocoon': this.metrics.cocoonRequests++; break;
            case 'commercial': this.metrics.commercialRequests++; break;
        }
    }

    private splitIntoChunks(text: string, chunkSize = 3): string[] {
        const words = text.split(' ');
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize).join(' ') + ' ');
        }
        return chunks;
    }

    async start(): Promise<void> {
        this.setupWebSocket();

        return new Promise((resolve) => {
            this.server.listen(this.config.apiPort, () => {
                console.log(`
╔══════════════════════════════════════════════╗
║           🐝 GSTD Bot — Omega Gateway        ║
╠══════════════════════════════════════════════╣
║  API:    http://0.0.0.0:${this.config.apiPort}                 ║
║  WS:     ws://0.0.0.0:${this.config.apiPort}/ws               ║
║  Models: auto, flash, pro, ultra, cocoon     ║
║  Swarm:  ${this.config.swarmUrl}        ║
║  Mode:   ${this.config.sovereigntyMode.padEnd(35)}║
╚══════════════════════════════════════════════╝
                `);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        this.wss?.close();
        this.server.close();
    }
}
