#!/usr/bin/env node
/**
 * GSTD Node Lite
 * Lightweight node client — connects any machine with Ollama to the GSTD network.
 *
 * Usage:
 *   npx tsx src/node-lite/index.ts --wallet EQ... [--name my-node] [--port 8765] [--ollama http://localhost:11434]
 *   or after build: gstd-node start --wallet EQ...
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { cpus, totalmem, freemem } from 'os';
import { randomBytes } from 'crypto';
import { execSync, spawn } from 'child_process';

const args  = process.argv.slice(2);
const flag  = (name: string) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag = (name: string) => args.includes(`--${name}`);

const WALLET      = flag('wallet')  || process.env.GSTD_WALLET_ADDRESS || '';
const NODE_NAME   = flag('name')    || process.env.NODE_NAME            || `lite-${randomBytes(3).toString('hex')}`;
const PORT        = parseInt(flag('port') || process.env.PORT || '8765', 10);
const OLLAMA_URL  = (flag('ollama') || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const SWARM_URL   = (flag('swarm')  || process.env.GSTD_SWARM_URL || 'https://app.gstdtoken.com').replace(/\/$/, '');
const NODE_ID     = flag('id') || process.env.GSTD_NODE_ID || `lite-${NODE_NAME}`;

let publicUrl = flag('public-url') || process.env.GSTD_PUBLIC_URL || '';
let ollamaModels: string[] = [];

// ── Detect Ollama models ────────────────────────────────────────────
async function detectModels(): Promise<string[]> {
    try {
        const resp = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!resp.ok) return [];
        const data: any = await resp.json();
        return (data.models || []).map((m: any) => m.name as string);
    } catch {
        return [];
    }
}

// ── Register + heartbeat ────────────────────────────────────────────
async function register() {
    ollamaModels = await detectModels();
    const body = {
        node_id:       NODE_ID,
        name:          NODE_NAME,
        wallet:        WALLET,
        node_url:      publicUrl,
        cpu_cores:     cpus().length,
        ram_mb:        Math.round(totalmem() / 1024 / 1024),
        ram_free_mb:   Math.round(freemem()  / 1024 / 1024),
        gpu:           false,
        capabilities:  ollamaModels,
        models:        ollamaModels,
        version:       '1.0.0-lite',
        status:        'online',
    };
    try {
        const r = await fetch(`${SWARM_URL}/api/v1/nodes/register`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(8000),
        });
        if (r.ok) console.log(`[GSTD] Registered: ${NODE_NAME} | models: ${ollamaModels.join(', ') || 'none'}`);
        else console.warn(`[GSTD] Register HTTP ${r.status}`);
    } catch (e: any) {
        console.warn(`[GSTD] Register failed: ${e.message}`);
    }
}

async function heartbeat() {
    ollamaModels = await detectModels();
    const body = {
        node_id:      NODE_ID,
        wallet:       WALLET,
        node_url:     publicUrl,
        ram_free_mb:  Math.round(freemem() / 1024 / 1024),
        capabilities: ollamaModels,
        models:       ollamaModels,
        status:       'online',
        version:      '1.0.0-lite',
    };
    try {
        await fetch(`${SWARM_URL}/api/v1/nodes/heartbeat`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(8000),
        });
    } catch { /* silent */ }
}

// ── Cloudflare Quick Tunnel ─────────────────────────────────────────
function startTunnel(): Promise<string> {
    return new Promise((resolve) => {
        let resolved = false;
        try {
            const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const onData = (data: Buffer) => {
                const text = data.toString();
                const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match && !resolved) {
                    resolved = true;
                    publicUrl = match[0];
                    console.log(`[Tunnel] Public URL: ${publicUrl}`);
                    resolve(publicUrl);
                }
            };
            proc.stdout.on('data', onData);
            proc.stderr.on('data', onData);
            proc.on('error', () => { if (!resolved) resolve(''); });
            setTimeout(() => { if (!resolved) { console.warn('[Tunnel] cloudflared not found — skipping tunnel'); resolve(''); } }, 10_000);
        } catch {
            resolve('');
        }
    });
}

// ── Proxy server ────────────────────────────────────────────────────
function proxyOllama(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
        const body = Buffer.concat(chunks);
        try {
            const upstream = await fetch(`${OLLAMA_URL}${req.url}`, {
                method:  req.method,
                headers: { 'Content-Type': 'application/json' },
                body:    body.length ? body : undefined,
                signal:  AbortSignal.timeout(55_000),
            });
            res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            const data = await upstream.text();
            res.end(data);
        } catch (e: any) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    });
}

async function main() {
    if (!WALLET) {
        console.error('Usage: gstd-node --wallet EQ... [--name my-node] [--port 8765]');
        process.exit(1);
    }

    // Check Ollama
    const models = await detectModels();
    if (models.length === 0) {
        console.warn('[GSTD] Warning: No Ollama models detected at', OLLAMA_URL);
        console.warn('       Install Ollama: https://ollama.ai  then run: ollama pull llama3.2:3b');
    } else {
        console.log(`[GSTD] Ollama models: ${models.join(', ')}`);
    }

    // Start proxy server
    const server = createServer((req, res) => {
        if (req.method === 'OPTIONS') {
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' });
            res.end();
            return;
        }
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, node: NODE_NAME, models: ollamaModels }));
            return;
        }
        proxyOllama(req, res);
    });
    server.listen(PORT, () => console.log(`[GSTD] Proxy server on :${PORT}`));

    // Cloudflare tunnel (if no public URL given)
    if (!publicUrl && !hasFlag('no-tunnel')) {
        console.log('[Tunnel] Starting Cloudflare quick tunnel...');
        await startTunnel();
    }

    // Register + start heartbeat
    await register();
    const hbInterval = setInterval(heartbeat, 30_000);

    console.log(`[GSTD] Node "${NODE_NAME}" is live! Wallet: ${WALLET}`);
    console.log(`[GSTD] Earning GSTD for every processed request.`);
    console.log(`[GSTD] Dashboard: ${SWARM_URL}`);

    process.on('SIGINT', () => {
        clearInterval(hbInterval);
        server.close();
        console.log('\n[GSTD] Node stopped.');
        process.exit(0);
    });
}

main().catch(console.error);
