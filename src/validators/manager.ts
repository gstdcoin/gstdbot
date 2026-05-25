/**
 * GSTD Validator Manager — toggle-based blockchain node hosting
 *
 * No Docker required. Native binaries only.
 * Hardware requirements shown per chain — operator enables what fits.
 *
 * Supported (lightweight, Pi-friendly):
 *   TON   — lite-client (~100MB RAM, fast sync)
 *   ETH   — Helios light client (~50MB RAM, instant)
 *   BTC   — Bitcoin Core pruned (~400MB RAM, ~5GB disk)
 *
 * Heavy (cloud server required — toggle available, not default):
 *   SOL   — needs 256GB SSD + 128GB RAM (future)
 *   XRP   — needs 32GB RAM (future)
 *
 * Toggle via API: POST /api/validators/:chain/toggle
 * Status via API: GET  /api/validators
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { logActivity } from '../gateway/server.js';

const CONFIG_DIR = process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot';
const VALIDATORS_FILE = join(CONFIG_DIR, 'validators.json');
const VALIDATORS_DIR  = join(CONFIG_DIR, 'validators');

export type ChainId = 'ton' | 'eth' | 'btc' | 'sol' | 'xrp';

export interface ChainSpec {
    id:           ChainId;
    name:         string;
    icon:         string;
    description:  string;
    type:         'light' | 'pruned' | 'full' | 'validator';
    ramMb:        number;       // minimum RAM in MB
    diskGb:       number;       // minimum disk in GB
    syncTimeMin:  number;       // estimated sync time in minutes
    earningsGstd: number;       // estimated GSTD/day
    installCmd?:  string;       // shell command to install binary
    startArgs?:   string[];     // args for the process
    rpcPort?:     number;
    available:    boolean;      // can run on this hardware
    heavyNote?:   string;       // shown when hardware insufficient
}

export interface ValidatorState {
    enabled:     boolean;
    status:      'stopped' | 'starting' | 'syncing' | 'ready' | 'error';
    syncPct:     number;
    peers:       number;
    blockHeight: number;
    errorMsg?:   string;
    pid?:        number;
    enabledAt?:  string;
    earnings:    number;       // GSTD earned since enabled
}

export interface ValidatorStatus extends ChainSpec {
    state: ValidatorState;
}

// ─── Chain specifications ─────────────────────────────────────────
const CHAIN_SPECS: Record<ChainId, ChainSpec> = {
    ton: {
        id: 'ton', name: 'TON Network', icon: '💎',
        description: 'TON lite-client — validates transactions, earns from RPC requests',
        type: 'light', ramMb: 256, diskGb: 2, syncTimeMin: 5, earningsGstd: 0.5,
        available: true,
        rpcPort: 43677,
    },
    eth: {
        id: 'eth', name: 'Ethereum', icon: '⟠',
        description: 'Helios light client — trustless ETH RPC without syncing 1TB',
        type: 'light', ramMb: 128, diskGb: 1, syncTimeMin: 1, earningsGstd: 0.8,
        available: true,
        rpcPort: 8545,
    },
    btc: {
        id: 'btc', name: 'Bitcoin', icon: '₿',
        description: 'Bitcoin Core pruned node — ~5GB disk, full verification',
        type: 'pruned', ramMb: 512, diskGb: 6, syncTimeMin: 480, earningsGstd: 1.2,
        available: true,
        rpcPort: 8332,
    },
    sol: {
        id: 'sol', name: 'Solana', icon: '◎',
        description: 'Solana RPC node',
        type: 'full', ramMb: 131072, diskGb: 256, syncTimeMin: 2880, earningsGstd: 3.0,
        available: false,
        heavyNote: 'Requires 128GB RAM + 256GB NVMe SSD. Enable on high-end server.',
        rpcPort: 8899,
    },
    xrp: {
        id: 'xrp', name: 'XRPL', icon: '✕',
        description: 'XRP Ledger validation node',
        type: 'validator', ramMb: 32768, diskGb: 50, syncTimeMin: 120, earningsGstd: 2.0,
        available: false,
        heavyNote: 'Requires 32GB RAM. Enable on cloud server.',
        rpcPort: 51235,
    },
};

// ─── Validator Manager ─────────────────────────────────────────────
export class ValidatorManager extends EventEmitter {
    private states = new Map<ChainId, ValidatorState>();
    private processes = new Map<ChainId, ChildProcess>();
    private pollTimer: NodeJS.Timeout | null = null;

    constructor() {
        super();
        mkdirSync(VALIDATORS_DIR, { recursive: true });
        this.loadStates();
    }

    // ─── Public API ───────────────────────────────────────────────

    getAll(): ValidatorStatus[] {
        return Object.values(CHAIN_SPECS).map(spec => ({
            ...spec,
            state: this.states.get(spec.id) || this.defaultState(),
        }));
    }

    getOne(id: ChainId): ValidatorStatus | null {
        const spec = CHAIN_SPECS[id];
        if (!spec) return null;
        return { ...spec, state: this.states.get(id) || this.defaultState() };
    }

    async toggle(id: ChainId): Promise<{ ok: boolean; message: string }> {
        const spec = CHAIN_SPECS[id];
        if (!spec) return { ok: false, message: 'Unknown chain' };

        const state = this.states.get(id) || this.defaultState();

        if (state.enabled) {
            await this.stop(id);
            return { ok: true, message: `${spec.name} validator stopped` };
        } else {
            const result = await this.start(id);
            return result;
        }
    }

    // ─── Start a validator ────────────────────────────────────────

    private async start(id: ChainId): Promise<{ ok: boolean; message: string }> {
        const spec = CHAIN_SPECS[id];
        const state = this.getOrCreate(id);
        state.enabled = true;
        state.status  = 'starting';
        state.enabledAt = new Date().toISOString();
        this.saveStates();

        logActivity(`Starting ${spec.name} validator...`, 'info');

        // For heavy chains: mark as "pending hardware upgrade"
        if (!spec.available) {
            state.status = 'error';
            state.errorMsg = spec.heavyNote || 'Hardware requirements not met';
            this.saveStates();
            return { ok: false, message: state.errorMsg };
        }

        // Launch the appropriate daemon
        let launched = false;
        switch (id) {
            case 'ton': launched = await this.startTon(state); break;
            case 'eth': launched = await this.startEth(state); break;
            case 'btc': launched = await this.startBtc(state); break;
            default: launched = false;
        }

        if (!launched) {
            state.status = 'error';
            state.errorMsg = 'Binary not installed. Use the install button first.';
            this.saveStates();
            return { ok: false, message: state.errorMsg };
        }

        state.status = 'syncing';
        this.saveStates();
        logActivity(`${spec.name} validator started (syncing...)`, 'success');
        return { ok: true, message: `${spec.name} validator started` };
    }

    private async startTon(state: ValidatorState): Promise<boolean> {
        // TON lite-client: lightweight, connects to public validators
        const binPath = '/home/bot/ton-bin/lite-client';
        if (!existsSync(binPath)) return false;

        const configPath = join(VALIDATORS_DIR, 'ton-global.config.json');
        if (!existsSync(configPath)) {
            // Download TON mainnet config
            try {
                execSync(`curl -fsSL https://ton.org/global.config.json -o ${configPath}`, { timeout: 15000 });
            } catch { return false; }
        }

        const proc = spawn(binPath, [
            '-C', configPath,
            '-t', '10',
            '--continue',
        ], {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (d: Buffer) => {
            const line = d.toString();
            if (line.includes('last masterchain block')) {
                const s = this.states.get('ton');
                if (s) { s.status = 'ready'; s.syncPct = 100; this.saveStates(); }
            }
        });

        this.processes.set('ton', proc);
        state.pid = proc.pid;
        proc.on('exit', () => {
            const s = this.states.get('ton');
            if (s?.enabled) { s.status = 'error'; s.errorMsg = 'Process exited'; this.saveStates(); }
        });
        return true;
    }

    private async startEth(state: ValidatorState): Promise<boolean> {
        // Helios ETH light client (Rust binary)
        const binPath = '/home/bot/helios-bin/helios';
        if (!existsSync(binPath)) return false;

        const proc = spawn(binPath, [
            '--network', 'mainnet',
            '--rpc-port', '8545',
            '--checkpoint', 'sync', // auto checkpoint sync
        ], {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (d: Buffer) => {
            const line = d.toString();
            if (line.includes('finalized block')) {
                const s = this.states.get('eth');
                if (s) { s.status = 'ready'; s.syncPct = 100; this.saveStates(); }
            }
        });

        this.processes.set('eth', proc);
        state.pid = proc.pid;
        proc.on('exit', () => {
            const s = this.states.get('eth');
            if (s?.enabled) { s.status = 'error'; s.errorMsg = 'Process exited'; this.saveStates(); }
        });
        return true;
    }

    private async startBtc(state: ValidatorState): Promise<boolean> {
        // Bitcoin Core with pruning (only need 5GB not 700GB)
        const binPath = '/home/bot/bitcoin-bin/bitcoind';
        if (!existsSync(binPath)) return false;

        const dataDir = join(VALIDATORS_DIR, 'bitcoin');
        mkdirSync(dataDir, { recursive: true });

        const proc = spawn(binPath, [
            `-datadir=${dataDir}`,
            '-prune=5120',          // 5GB pruned
            '-listen=0',            // don't accept incoming (behind NAT)
            '-rpcport=8332',
            '-rpcbind=127.0.0.1',
            '-rpcallowip=127.0.0.1',
            '-maxconnections=8',
        ], {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.processes.set('btc', proc);
        state.pid = proc.pid;
        proc.on('exit', () => {
            const s = this.states.get('btc');
            if (s?.enabled) { s.status = 'error'; s.errorMsg = 'Process exited'; this.saveStates(); }
        });
        return true;
    }

    // ─── Stop a validator ─────────────────────────────────────────

    private async stop(id: ChainId): Promise<void> {
        const proc = this.processes.get(id);
        if (proc) {
            proc.kill('SIGTERM');
            this.processes.delete(id);
        }
        const state = this.getOrCreate(id);
        state.enabled = false;
        state.status = 'stopped';
        state.pid = undefined;
        this.saveStates();
        logActivity(`${CHAIN_SPECS[id].name} validator stopped`, 'info');
    }

    // ─── Install binary for a chain ───────────────────────────────

    async installBinary(id: ChainId): Promise<{ ok: boolean; message: string }> {
        const spec = CHAIN_SPECS[id];
        if (!spec?.available) return { ok: false, message: 'Chain not available on this hardware' };

        // Run install in background, report progress via state
        const state = this.getOrCreate(id);
        state.status = 'starting';
        this.saveStates();

        try {
            switch (id) {
                case 'ton': await this.installTon(); break;
                case 'eth': await this.installEth(); break;
                case 'btc': await this.installBtc(); break;
                default: return { ok: false, message: 'Auto-install not available for this chain' };
            }
            state.status = 'stopped';
            this.saveStates();
            logActivity(`${spec.name} binary installed successfully`, 'success');
            return { ok: true, message: `${spec.name} binary installed` };
        } catch (e: any) {
            state.status = 'error';
            state.errorMsg = e.message;
            this.saveStates();
            return { ok: false, message: e.message };
        }
    }

    private async installTon(): Promise<void> {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
        const url  = `https://github.com/ton-blockchain/ton/releases/latest/download/lite-client-linux-${arch}`;
        mkdirSync('/home/bot/ton-bin', { recursive: true });
        execSync(`curl -fsSL "${url}" -o /home/bot/ton-bin/lite-client && chmod +x /home/bot/ton-bin/lite-client`, { timeout: 120000 });
    }

    private async installEth(): Promise<void> {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
        // Helios is a Rust light client — grab latest release
        const url = `https://github.com/a16z/helios/releases/latest/download/helios-${arch}-unknown-linux-gnu.tar.gz`;
        mkdirSync('/home/bot/helios-bin', { recursive: true });
        execSync(`curl -fsSL "${url}" | tar -xz -C /home/bot/helios-bin/ && chmod +x /home/bot/helios-bin/helios`, { timeout: 120000 });
    }

    private async installBtc(): Promise<void> {
        const arch = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
        const ver  = '28.0';
        const url  = `https://bitcoincore.org/bin/bitcoin-core-${ver}/bitcoin-${ver}-${arch}.tar.gz`;
        mkdirSync('/home/bot/bitcoin-bin', { recursive: true });
        execSync(`curl -fsSL "${url}" | tar -xz -C /tmp/btc-tmp --strip-components=2 "bitcoin-${ver}/bin/bitcoind" && mv /tmp/btc-tmp/bitcoind /home/bot/bitcoin-bin/ && chmod +x /home/bot/bitcoin-bin/bitcoind`, { timeout: 300000 });
    }

    // ─── Poll status ──────────────────────────────────────────────

    startPolling(): void {
        this.pollTimer = setInterval(() => this.pollAll(), 30_000);
    }

    private async pollAll(): Promise<void> {
        for (const [id, state] of this.states) {
            if (!state.enabled || state.status === 'stopped') continue;
            await this.pollOne(id as ChainId, state).catch(() => {});
        }
    }

    private async pollOne(id: ChainId, state: ValidatorState): Promise<void> {
        const port = CHAIN_SPECS[id]?.rpcPort;
        if (!port) return;

        try {
            if (id === 'btc') {
                const r = await fetch(`http://127.0.0.1:${port}/`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '1.0', method: 'getblockchaininfo' }),
                    signal: AbortSignal.timeout(3000),
                });
                if (r.ok) {
                    const d: any = await r.json();
                    state.syncPct = Math.round((d.result?.verificationprogress || 0) * 100);
                    state.blockHeight = d.result?.blocks || 0;
                    state.peers = d.result?.connections || 0;
                    state.status = state.syncPct >= 99 ? 'ready' : 'syncing';
                }
            } else if (id === 'eth') {
                const r = await fetch(`http://127.0.0.1:${port}/`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_syncing', params: [], id: 1 }),
                    signal: AbortSignal.timeout(3000),
                });
                if (r.ok) {
                    const d: any = await r.json();
                    const syncing = d.result;
                    if (syncing === false) { state.status = 'ready'; state.syncPct = 100; }
                    else if (syncing?.currentBlock) {
                        const cur = parseInt(syncing.currentBlock, 16);
                        const hi  = parseInt(syncing.highestBlock, 16);
                        state.syncPct = hi > 0 ? Math.round((cur / hi) * 100) : 0;
                    }
                }
            }
            this.saveStates();
        } catch { /* validator unreachable */ }
    }

    // ─── Persistence ──────────────────────────────────────────────

    private getOrCreate(id: ChainId): ValidatorState {
        if (!this.states.has(id)) this.states.set(id, this.defaultState());
        return this.states.get(id)!;
    }

    private defaultState(): ValidatorState {
        return { enabled: false, status: 'stopped', syncPct: 0, peers: 0, blockHeight: 0, earnings: 0 };
    }

    private loadStates(): void {
        try {
            if (!existsSync(VALIDATORS_FILE)) return;
            const raw: Record<string, ValidatorState> = JSON.parse(readFileSync(VALIDATORS_FILE, 'utf-8'));
            for (const [id, state] of Object.entries(raw)) {
                // Reset running processes (they died on restart)
                state.status = state.enabled ? 'stopped' : 'stopped';
                state.pid = undefined;
                this.states.set(id as ChainId, state);
            }
        } catch { /* ignore */ }
    }

    private saveStates(): void {
        try {
            const obj: Record<string, ValidatorState> = {};
            for (const [id, state] of this.states) obj[id] = state;
            writeFileSync(VALIDATORS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
        } catch { /* ignore */ }
    }

    stop_all(): void {
        if (this.pollTimer) clearInterval(this.pollTimer);
        for (const [id] of this.processes) this.stop(id as ChainId).catch(() => {});
    }
}
