/**
 * GSTD IPFS Storage Layer
 *
 * Wraps the local Kubo (go-ipfs) HTTP API.
 * Each GSTD node runs its own IPFS daemon — no central service.
 *
 * Content addressing: every file has a CID (hash).
 * Any node that has pinned a CID can serve it.
 * Multiple nodes = redundancy without a central server.
 *
 * Fee model: uploader pays X GSTD/GB/day → distributed to pinning nodes.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';

const IPFS_API = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const PINS_FILE = join(process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot', 'ipfs_pins.json');

export interface PinRecord {
    cid:        string;
    name:       string;
    size:       number;       // bytes
    pinnedAt:   string;       // ISO
    expiresAt?: string;       // ISO, undefined = permanent
    ownerNode?: string;
    tags:       string[];
}

export interface IpfsStats {
    peerId:      string;
    peers:       number;
    repoSize:    number;     // bytes
    numPins:     number;
    enabled:     boolean;
}

export class IpfsClient {
    private enabled = false;
    private peerId  = '';
    private pins    = new Map<string, PinRecord>();

    async init(): Promise<void> {
        try {
            const resp = await fetch(`${IPFS_API}/api/v0/id`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000),
            });
            if (!resp.ok) return;
            const data: any = await resp.json();
            this.peerId  = data.ID || '';
            this.enabled = true;
            this.loadPins();
            console.log(`    IPFS: peer ${this.peerId.slice(0, 20)}... (${this.pins.size} pins)`);
        } catch {
            console.log('    IPFS: daemon not reachable — storage disabled');
        }
    }

    get isEnabled(): boolean { return this.enabled; }
    get peerIdShort(): string { return this.peerId.slice(0, 20); }

    // ─── Add (upload) ─────────────────────────────────────────────

    async add(data: Buffer | string, name = 'file'): Promise<{ cid: string; size: number } | null> {
        if (!this.enabled) return null;
        try {
            const buf = typeof data === 'string' ? Buffer.from(data) : data;

            // Multipart form data
            const boundary = `----gstd${Date.now()}`;
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;
            const body   = Buffer.concat([Buffer.from(header), buf, Buffer.from(footer)]);

            const resp = await fetch(`${IPFS_API}/api/v0/add?pin=true&quieter=true`, {
                method:  'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body,
                signal:  AbortSignal.timeout(60_000),
            });
            if (!resp.ok) return null;
            const result: any = await resp.json();
            const cid  = result.Hash || result.Cid?.['/'];
            if (!cid) return null;

            const pin: PinRecord = {
                cid, name,
                size:     parseInt(result.Size) || buf.length,
                pinnedAt: new Date().toISOString(),
                tags:     [],
            };
            this.pins.set(cid, pin);
            this.savePins();
            return { cid, size: pin.size };
        } catch {
            return null;
        }
    }

    // ─── Cat (retrieve) ───────────────────────────────────────────

    async cat(cid: string): Promise<Buffer | null> {
        if (!this.enabled) return null;
        try {
            const resp = await fetch(`${IPFS_API}/api/v0/cat?arg=${encodeURIComponent(cid)}`, {
                method: 'POST',
                signal: AbortSignal.timeout(30_000),
            });
            if (!resp.ok) return null;
            return Buffer.from(await resp.arrayBuffer());
        } catch {
            return null;
        }
    }

    // ─── Pin (store a CID from the network) ───────────────────────

    async pin(cid: string, name = '', ownerNode = ''): Promise<boolean> {
        if (!this.enabled) return false;
        try {
            const resp = await fetch(`${IPFS_API}/api/v0/pin/add?arg=${encodeURIComponent(cid)}`, {
                method: 'POST',
                signal: AbortSignal.timeout(120_000),
            });
            if (!resp.ok) return false;

            const pin: PinRecord = {
                cid, name,
                size:      0, // will be updated on stat
                pinnedAt:  new Date().toISOString(),
                ownerNode,
                tags:      [],
            };
            this.pins.set(cid, pin);
            this.savePins();

            // Update size in background
            this.statCid(cid).then(size => {
                const p = this.pins.get(cid);
                if (p) { p.size = size; this.savePins(); }
            }).catch(() => {});

            return true;
        } catch {
            return false;
        }
    }

    // ─── Unpin ────────────────────────────────────────────────────

    async unpin(cid: string): Promise<boolean> {
        if (!this.enabled) return false;
        try {
            await fetch(`${IPFS_API}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`, {
                method: 'POST',
                signal: AbortSignal.timeout(10_000),
            });
            this.pins.delete(cid);
            this.savePins();
            return true;
        } catch {
            return false;
        }
    }

    // ─── Stats ────────────────────────────────────────────────────

    async getStats(): Promise<IpfsStats> {
        if (!this.enabled) return { peerId: '', peers: 0, repoSize: 0, numPins: this.pins.size, enabled: false };
        try {
            const [repoResp, peersResp] = await Promise.all([
                fetch(`${IPFS_API}/api/v0/repo/stat?human=false`, { method: 'POST', signal: AbortSignal.timeout(5000) }),
                fetch(`${IPFS_API}/api/v0/swarm/peers`,           { method: 'POST', signal: AbortSignal.timeout(5000) }),
            ]);
            const repo: any  = repoResp.ok  ? await repoResp.json()  : {};
            const peers: any = peersResp.ok ? await peersResp.json() : {};
            return {
                peerId:   this.peerId,
                peers:    peers.Peers?.length || 0,
                repoSize: repo.RepoSize || 0,
                numPins:  this.pins.size,
                enabled:  true,
            };
        } catch {
            return { peerId: this.peerId, peers: 0, repoSize: 0, numPins: this.pins.size, enabled: true };
        }
    }

    getPins(): PinRecord[] {
        return Array.from(this.pins.values());
    }

    getPin(cid: string): PinRecord | null {
        return this.pins.get(cid) || null;
    }

    // ─── Internal ─────────────────────────────────────────────────

    private async statCid(cid: string): Promise<number> {
        try {
            const resp = await fetch(`${IPFS_API}/api/v0/object/stat?arg=${encodeURIComponent(cid)}`, {
                method: 'POST', signal: AbortSignal.timeout(10_000),
            });
            if (!resp.ok) return 0;
            const d: any = await resp.json();
            return d.CumulativeSize || d.DataSize || 0;
        } catch { return 0; }
    }

    private loadPins(): void {
        try {
            if (!existsSync(PINS_FILE)) return;
            const raw: PinRecord[] = JSON.parse(readFileSync(PINS_FILE, 'utf-8'));
            for (const p of raw) this.pins.set(p.cid, p);
        } catch { /* ignore */ }
    }

    private savePins(): void {
        try {
            writeFileSync(PINS_FILE, JSON.stringify(Array.from(this.pins.values()), null, 2), 'utf-8');
        } catch { /* ignore */ }
    }
}
