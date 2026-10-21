/**
 * Sovereign node: one OS process, one Ed25519 identity, direct signed-message
 * exchange with other nodes. It needs no central API, DNS name, CDN or chat
 * service to discover peers it already knows, distribute tasks, verify
 * results or keep its ledger replica.
 *
 * Transport: signed envelopes over direct HTTP between nodes (push gossip for
 * latency + pull anti-entropy for durability and partition healing). libp2p
 * stays available in src/p2p/node.ts; this slice does not depend on it.
 */

import http from 'http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import {
    canonicalize, loadOrCreateIdentity, sha256Hex, signEnvelope, type Envelope, type NodeIdentity,
} from './crypto.js';
import {
    Board, ManifestSchema, ROLES, failoverMs, type Announce, type Manifest, type Role,
} from './board.js';
import { DEFAULT_ADAPTER_CONFIG, type AdapterConfig } from './adapters.js';
import { ProviderRegistry } from './providers.js';
import { DEFAULT_PARAMS, Ledger, simulatePayout, type RewardParams } from './rewards.js';

export interface SovereignConfig {
    dataDir: string;
    host: string;
    port: number;
    roles: Role[];
    bootstrap: string[];
    publicUrl?: string;
    adapter: AdapterConfig;
    loopMs: number;
    allowPrivatePeers: boolean;
    priceNano: string;
    rewardParams: RewardParams;
    /** Delay before a data worker fetches. Used by failure tests; 0 in production. */
    fetchDelayMs: number;
    /** Only honoured when GSTD_SOV_FAULT_INJECTION=1; lets tests model a lying worker. */
    faultInjection?: { tamperResults?: boolean };
}

export function defaultConfig(dataDir: string): SovereignConfig {
    return {
        dataDir, host: '127.0.0.1', port: 0, roles: ['data', 'verify', 'relay'], bootstrap: [],
        adapter: { ...DEFAULT_ADAPTER_CONFIG }, loopMs: 400, allowPrivatePeers: false, priceNano: '0',
        rewardParams: { ...DEFAULT_PARAMS }, fetchDelayMs: 0,
    };
}

/** Lightweight devices get light roles by default; compute is never assigned to weak hardware. */
export function suggestRoles(cpuCores: number, ramGb: number): Role[] {
    if (cpuCores >= 8 && ramGb >= 16) return ['compute', 'data', 'verify', 'relay'];
    if (cpuCores >= 4 && ramGb >= 3) return ['data', 'verify', 'relay'];
    return ['verify', 'relay'];
}

interface PeerRecord { url: string; source: 'bootstrap' | 'gossip' | 'inbound' | 'admin'; failures: number; lastOk: number | null }

const PEER_FAILURE_DROP = 12;
const MAX_PEERS = 64;
const MAX_BODY = 1024 * 1024;

export function isPrivateHost(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '0.0.0.0' || h === '::1' || /^127\./.test(h) || /^10\./.test(h)
        || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/.test(h);
}

export class SovereignNode {
    readonly identity: NodeIdentity;
    readonly board = new Board();
    readonly providers = new ProviderRegistry();
    readonly ledger: Ledger;
    private peers = new Map<string, PeerRecord>();
    private server: http.Server | null = null;
    private timer: NodeJS.Timeout | null = null;
    private busy = false;
    private inflight = new Set<string>();
    private rate = new Map<string, { n: number; reset: number }>();
    private adminToken: string;
    private lastAnnounce = 0;
    private readonly objectsFile: string;
    private readonly peersFile: string;
    port = 0;

    constructor(readonly cfg: SovereignConfig) {
        mkdirSync(cfg.dataDir, { recursive: true });
        this.identity = loadOrCreateIdentity(cfg.dataDir);
        this.objectsFile = join(cfg.dataDir, 'objects.jsonl');
        this.peersFile = join(cfg.dataDir, 'peers.json');
        this.ledger = new Ledger(join(cfg.dataDir, 'ledger.jsonl'), cfg.rewardParams);
        const tokenFile = join(cfg.dataDir, 'admin.token');
        if (existsSync(tokenFile)) this.adminToken = readFileSync(tokenFile, 'utf-8').trim();
        else { this.adminToken = randomBytes(24).toString('hex'); writeFileSync(tokenFile, this.adminToken, { mode: 0o600 }); }
        this.restore();
    }

    get nodeId(): string { return this.identity.nodeId; }
    get url(): string { return this.cfg.publicUrl ?? `http://${this.cfg.host}:${this.port}`; }

    // ── persistence ──────────────────────────────────────────────
    private restore(): void {
        if (existsSync(this.objectsFile)) {
            for (const line of readFileSync(this.objectsFile, 'utf-8').split('\n')) {
                if (!line.trim()) continue;
                try { this.board.ingest(JSON.parse(line)); } catch { /* torn final line after a crash */ }
            }
        }
        if (existsSync(this.peersFile)) {
            try {
                for (const p of JSON.parse(readFileSync(this.peersFile, 'utf-8')) as PeerRecord[]) this.peers.set(p.url, p);
            } catch { /* start with bootstrap only */ }
        }
        for (const b of this.cfg.bootstrap) this.addPeer(b, 'bootstrap');
    }

    private savePeers(): void {
        const tmp = `${this.peersFile}.tmp`;
        writeFileSync(tmp, JSON.stringify([...this.peers.values()]));
        renameSync(tmp, this.peersFile);
    }

    private store(env: Envelope): boolean {
        const r = this.board.ingest(env);
        if (r.added) appendFileSync(this.objectsFile, JSON.stringify(env) + '\n');
        return r.added;
    }

    // ── peers ────────────────────────────────────────────────────
    addPeer(raw: string, source: PeerRecord['source']): boolean {
        let origin: string;
        try {
            const u = new URL(raw);
            if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return false;
            if (!this.cfg.allowPrivatePeers && source !== 'bootstrap' && source !== 'admin' && isPrivateHost(u.hostname)) return false;
            origin = u.origin;
        } catch { return false; }
        if (origin === this.url) return false;
        if (this.peers.has(origin)) return false;
        if (this.peers.size >= MAX_PEERS && source !== 'bootstrap') return false;
        this.peers.set(origin, { url: origin, source, failures: 0, lastOk: null });
        this.savePeers();
        return true;
    }

    peerList(): PeerRecord[] { return [...this.peers.values()]; }

    private async call(url: string, path: string, body?: unknown): Promise<any> {
        const resp = await fetch(`${url}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? {} : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(3000),
            redirect: 'error',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    private async push(env: Envelope): Promise<void> {
        await Promise.allSettled([...this.peers.values()].map(p => this.call(p.url, '/sov/msg', { envelope: env, from: this.url }).then(
            () => { p.lastOk = Date.now(); p.failures = 0; },
            () => { p.failures++; },
        )));
    }

    private async syncPeer(p: PeerRecord): Promise<void> {
        try {
            const other = await this.call(p.url, `/sov/sync?from=${encodeURIComponent(this.url)}`);
            p.lastOk = Date.now(); p.failures = 0;
            for (const u of Array.isArray(other.peers) ? other.peers.slice(0, 50) : []) if (typeof u === 'string') this.addPeer(u, 'gossip');
            const missing = (Array.isArray(other.ids) ? other.ids : []).filter((id: unknown) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) && !this.board.has(id));
            for (let i = 0; i < missing.length; i += 100) {
                const got = await this.call(p.url, '/sov/objects', { ids: missing.slice(i, i + 100) });
                for (const e of Array.isArray(got.objects) ? got.objects : []) this.store(e);
            }
        } catch {
            p.failures++;
            if (p.failures >= PEER_FAILURE_DROP && p.source !== 'bootstrap') this.peers.delete(p.url);
        }
    }

    // ── publishing ───────────────────────────────────────────────
    private emit<P>(type: string, payload: P): Envelope<P> {
        const env = signEnvelope(this.identity, type, payload);
        this.store(env);
        void this.push(env);
        return env;
    }

    publishTask(input: { package: string; funding: 'commercial' | 'subsidized'; budgetNano: string; minVerifiers?: number; leaseMs?: number; deadlineMs?: number; maxAttempts?: number; backups?: string[] }): string {
        const manifest: Manifest = ManifestSchema.parse({
            kind: 'data.fetch', adapter: 'npm-registry', params: { package: input.package }, entity: `npm:${input.package}`,
            funding: input.funding, budgetNano: input.budgetNano, minVerifiers: input.minVerifiers ?? 1,
            leaseMs: input.leaseMs ?? 15_000, deadline: Date.now() + (input.deadlineMs ?? 120_000),
            maxAttempts: input.maxAttempts ?? 3, acceptance: 'verifier-hash-match',
            ...(input.backups && input.backups.length > 0 ? { backups: input.backups.filter(b => b !== this.nodeId) } : {}),
        });
        return this.emit('task.publish', manifest).id;
    }

    private announce(): void {
        const payload: Announce = {
            roles: this.cfg.roles.filter(r => ROLES.includes(r)),
            adapters: this.providers.ids(), priceNano: this.cfg.priceNano, httpUrl: this.url, protocol: 1,
        };
        this.emit('node.announce', payload);
        this.lastAnnounce = Date.now();
    }

    // ── duties ───────────────────────────────────────────────────
    private hostOf(nodeId: string): string {
        try { return new URL(this.board.announces().get(nodeId)?.payload.httpUrl ?? '').hostname; } catch { return ''; }
    }

    /**
     * Preference order: lowest price, different host than `avoidHosts` (one
     * operator running many identities on one machine should not fill every
     * role), proven history, then a task-specific deterministic tiebreak.
     * Host diversity is a soft preference, not Sybil resistance.
     */
    private candidates(role: 'data' | 'verify', exclude: Set<string>, taskId: string, avoidHosts: Set<string> = new Set()): string[] {
        const accepted = new Map<string, number>();
        for (const id of this.board.taskIds()) {
            const ev = this.board.evaluate(id);
            if (ev.status === 'accepted' && ev.worker) accepted.set(ev.worker, (accepted.get(ev.worker) ?? 0) + 1);
        }
        const sameHost = (id: string) => { const h = this.hostOf(id); return h !== '' && avoidHosts.has(h) ? 1 : 0; };
        return [...this.board.announces().values()]
            .filter(a => a.payload.roles.includes(role) && a.payload.adapters.includes('npm-registry') && !exclude.has(a.signer))
            .sort((a, b) => {
                const price = BigInt(a.payload.priceNano) - BigInt(b.payload.priceNano);
                if (price !== 0n) return price < 0n ? -1 : 1;
                const diversity = sameHost(a.signer) - sameHost(b.signer);
                if (diversity !== 0) return diversity;
                const q = (accepted.get(b.signer) ?? 0) - (accepted.get(a.signer) ?? 0);
                if (q !== 0) return q;
                const ha = sha256Hex(`${taskId}|${a.signer}`); const hb = sha256Hex(`${taskId}|${b.signer}`);
                return ha < hb ? -1 : 1;
            })
            .map(a => a.signer);
    }

    /** True when this node should coordinate the task now: it is the publisher, or an authorized backup after silence. */
    private coordinates(taskId: string, now: number): boolean {
        const m = this.board.manifest(taskId);
        if (!m) return false;
        if (m.signer === this.nodeId) return true;
        const rank = (m.payload.backups ?? []).indexOf(this.nodeId);
        if (rank < 0) return false;
        const last = this.board.lastCoordinator(taskId);
        if (!last) return false;
        if (last.signer === this.nodeId) return true;
        return now - last.ts >= failoverMs(m.payload) * (rank + 1);
    }

    private publisherDuty(now: number): void {
        for (const taskId of this.board.taskIds()) {
            const m = this.board.manifest(taskId)!;
            if (!this.coordinates(taskId, now)) continue;
            const ev = this.board.evaluate(taskId, now);
            const mine = this.board.finalizes(taskId);

            if (ev.status === 'accepted' || ev.status === 'rejected') {
                if (mine.length === 0) {
                    this.emit('task.finalize', { taskId, decision: ev.status, reason: ev.reason, ...(ev.resultId ? { resultId: ev.resultId } : {}) });
                }
                continue;
            }
            if (ev.status === 'expired') continue;

            const reserved = new Set([m.signer, ...(m.payload.backups ?? []), this.nodeId]);
            const dataLeases = this.board.leases(taskId).filter(l => l.payload.role === 'data');
            const hasResult = this.board.results(taskId).length > 0;
            const latest = dataLeases[dataLeases.length - 1];
            if (!hasResult && (!latest || (latest.payload.expiresAt < now && dataLeases.length < m.payload.maxAttempts))) {
                const used = new Set([...dataLeases.map(l => l.payload.worker), ...reserved]);
                const [worker] = this.candidates('data', used, taskId);
                if (worker) {
                    this.emit('task.lease', { taskId, role: 'data', worker, epoch: (latest?.payload.epoch ?? 0) + 1, expiresAt: now + m.payload.leaseMs });
                }
            }
            const first = this.board.results(taskId)[0];
            if (first) {
                const vLeases = this.board.leases(taskId).filter(l => l.payload.role === 'verify');
                const active = vLeases.filter(l => l.payload.expiresAt >= now || this.board.attests(taskId, first.id).some(a => a.signer === l.payload.worker));
                if (active.length < m.payload.minVerifiers) {
                    const used = new Set([...vLeases.map(l => l.payload.worker), ...reserved, first.signer]);
                    const avoid = new Set([this.hostOf(first.signer)].filter(Boolean));
                    for (const v of this.candidates('verify', used, taskId, avoid).slice(0, m.payload.minVerifiers - active.length)) {
                        this.emit('task.lease', { taskId, role: 'verify', worker: v, epoch: 1, expiresAt: now + m.payload.leaseMs });
                    }
                }
            }
        }
    }

    private workerDuty(now: number): void {
        if (!this.cfg.roles.includes('data')) return;
        for (const l of this.board.all().filter(e => e.type === 'task.lease') as Envelope<{ taskId: string; role: string; worker: string; epoch: number; expiresAt: number }>[]) {
            if (l.payload.role !== 'data' || l.payload.worker !== this.nodeId) continue;
            if (!this.board.leases(l.payload.taskId).some(x => x.id === l.id)) continue;
            if (l.payload.expiresAt < now || this.inflight.has(l.id)) continue;
            if (this.board.results(l.payload.taskId).some(r => r.signer === this.nodeId)) continue;
            this.inflight.add(l.id);
            void this.runFetch(l).finally(() => this.inflight.delete(l.id));
        }
    }

    private fetchVia(adapter: string, params: Record<string, unknown>) {
        const provider = this.providers.get(adapter);
        if (!provider) throw new Error(`no provider for adapter ${adapter}`);
        provider.validate(params);
        return provider.fetch(params, this.cfg.adapter);
    }

    private async runFetch(lease: Envelope<{ taskId: string; epoch: number }>): Promise<void> {
        try {
            if (this.cfg.fetchDelayMs > 0) await new Promise(r => setTimeout(r, this.cfg.fetchDelayMs));
            const m = this.board.manifest(lease.payload.taskId);
            if (!m) return;
            const version = await this.fetchVia(m.payload.adapter, m.payload.params);
            if (process.env.GSTD_SOV_FAULT_INJECTION === '1' && this.cfg.faultInjection?.tamperResults) {
                const content = { ...(version.content as object), versions: [{ version: '9.9.9-injected', publishedAt: null }] };
                version.content = content;
                version.contentHash = sha256Hex(canonicalize(content));
            }
            this.emit('task.result', { taskId: lease.payload.taskId, leaseId: lease.id, version });
        } catch { /* lease expires and the publisher reassigns */ }
    }

    private verifierDuty(): void {
        if (!this.cfg.roles.includes('verify')) return;
        for (const taskId of this.board.taskIds()) {
            const mine = this.board.leases(taskId).find(l => l.payload.role === 'verify' && l.payload.worker === this.nodeId);
            if (!mine) continue;
            for (const r of this.board.results(taskId)) {
                if (r.signer === this.nodeId) continue;
                const key = `${r.id}:${this.nodeId}`;
                if (this.inflight.has(key)) continue;
                if (this.board.all().some(e => e.type === 'task.attest' && e.signer === this.nodeId && (e.payload as { resultId: string }).resultId === r.id)) continue;
                this.inflight.add(key);
                void this.runVerify(taskId, r).finally(() => this.inflight.delete(key));
                break;
            }
        }
    }

    private async runVerify(taskId: string, result: Envelope<{ version: { contentHash: string } }>): Promise<void> {
        const m = this.board.manifest(taskId);
        if (!m) return;
        try {
            const mine = await this.fetchVia(m.payload.adapter, m.payload.params);
            const same = mine.contentHash === result.payload.version.contentHash;
            this.emit('task.attest', {
                taskId, resultId: result.id, verdict: same ? 'match' : 'mismatch', observedHash: mine.contentHash,
                reason: same ? 'independent fetch reproduced the content hash' : 'independent fetch produced different content',
            });
        } catch (err) {
            this.emit('task.attest', { taskId, resultId: result.id, verdict: 'inconclusive', reason: `source unavailable: ${(err as Error).message}`.slice(0, 200) });
        }
    }

    private ledgerDuty(): void {
        for (const taskId of this.board.taskIds()) this.ledger.accrueTask(taskId, this.board);
    }

    private async tick(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        try {
            const now = Date.now();
            if (now - this.lastAnnounce > 300_000) this.announce();
            for (const p of [...this.peers.values()].slice(0, 20)) await this.syncPeer(p);
            this.publisherDuty(now);
            this.workerDuty(now);
            this.verifierDuty();
            this.ledgerDuty();
            this.savePeers();
        } finally { this.busy = false; }
    }

    // ── HTTP ─────────────────────────────────────────────────────
    private limited(ip: string): boolean {
        const now = Date.now();
        const e = this.rate.get(ip);
        if (!e || now > e.reset) { this.rate.set(ip, { n: 1, reset: now + 60_000 }); return false; }
        return ++e.n > 6000;
    }

    private readBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let size = 0; const chunks: Buffer[] = [];
            req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
            req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {}); } catch (e) { reject(e); } });
            req.on('error', reject);
        });
    }

    private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', 'http://local');
        const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (this.limited(req.socket.remoteAddress ?? 'unknown')) return send(429, { error: 'rate limited' });
        const p = url.pathname;

        if (p.startsWith('/sov/admin/')) {
            if (req.headers['x-sov-admin'] !== this.adminToken) return send(401, { error: 'admin token required' });
            if (p === '/sov/admin/publish' && req.method === 'POST') {
                try { return send(200, { taskId: this.publishTask(await this.readBody(req)) }); } catch (e) { return send(400, { error: (e as Error).message }); }
            }
            if (p === '/sov/admin/peer' && req.method === 'POST') {
                const b = await this.readBody(req); return send(200, { added: this.addPeer(String(b.url ?? ''), 'admin') });
            }
            if (p === '/sov/admin/ledger') return send(200, { accruals: this.ledger.list(), simulation: simulatePayout(this.ledger) });
            return send(404, { error: 'not found' });
        }

        if (p === '/sov/health') return send(200, { nodeId: this.nodeId, roles: this.cfg.roles, objects: this.board.size(), protocol: 1 });
        if (p === '/sov/sync') {
            const from = url.searchParams.get('from');
            if (from) this.addPeer(from, 'inbound');
            return send(200, {
                nodeId: this.nodeId,
                peers: [this.url, ...[...this.peers.values()].filter(x => x.failures < 3).map(x => x.url)].slice(0, 50),
                ids: this.board.ids().slice(0, 20000),
            });
        }
        if (p === '/sov/objects' && req.method === 'POST') {
            const b = await this.readBody(req);
            const ids: string[] = Array.isArray(b.ids) ? b.ids.slice(0, 200) : [];
            return send(200, { objects: ids.map(id => this.board.get(id)).filter(Boolean) });
        }
        if (p === '/sov/msg' && req.method === 'POST') {
            const b = await this.readBody(req);
            if (typeof b.from === 'string') this.addPeer(b.from, 'inbound');
            const added = this.store(b.envelope);
            if (added) void this.push(b.envelope);
            return send(200, { added });
        }
        if (p === '/sov/entities') return send(200, { entities: this.board.entities() });
        if (p === '/sov/tasks') {
            return send(200, { tasks: this.board.taskIds().map(id => ({ taskId: id, ...this.board.evaluate(id) })) });
        }
        if (p === '/sov/query') {
            const entity = url.searchParams.get('entity') ?? '';
            const history = this.board.history(entity);
            if (history.length === 0) return send(404, { error: 'unknown entity', entity });
            const current = history[history.length - 1];
            return send(200, {
                entity,
                current: { ...current, content: this.board.contentOf(current.resultId)?.content, proof: this.board.proofBundle(current.taskId) },
                history,
                note: 'Hashes prove integrity of the fetched data, not that the source was truthful. Verify the proof bundle offline.',
            });
        }
        return send(404, { error: 'not found' });
    }

    async start(): Promise<number> {
        this.server = http.createServer((req, res) => { this.route(req, res).catch(() => { try { res.writeHead(400); res.end('{"error":"bad request"}'); } catch { /* socket closed */ } }); });
        await new Promise<void>(resolve => this.server!.listen(this.cfg.port, this.cfg.host, resolve));
        this.port = (this.server.address() as { port: number }).port;
        this.announce();
        this.timer = setInterval(() => { void this.tick(); }, this.cfg.loopMs);
        void this.tick();
        return this.port;
    }

    async stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
        this.server?.closeAllConnections?.();
    }
}
