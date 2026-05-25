/**
 * GSTD SuperNode — Storage Vault (Storj/Filecoin style)
 *
 * Nodes contribute disk space → earn GSTD for:
 *   - Storing encrypted data shards
 *   - Passing Proof-of-Storage challenges
 *   - Maintaining uptime and data availability
 *
 * Architecture:
 *   File → AES-256 encrypt → Reed-Solomon erasure coding → 
 *   Distribute shards to nodes → PoSt challenges every 6h →
 *   Reward GSTD per GB/day
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logActivity } from '../gateway/server.js';
import type { RevenueEngine } from '../revenue/engine.js';

// ─── Types ───────────────────────────────────────────────────────
export interface StorageShard {
    id: string;
    fileHash: string;
    shardIndex: number;
    totalShards: number;
    size: number;           // bytes
    checksum: string;       // SHA-256 of shard data
    storedAt: string;       // ISO timestamp
    expiresAt: string;      // ISO timestamp
    ownerNode: string;      // node that requested storage
    lastVerified: string;   // last PoSt check
    verified: boolean;
}

export interface StorageStats {
    totalCapacityGB: number;
    usedGB: number;
    availableGB: number;
    shardsStored: number;
    uptimeHours: number;
    postsCompleted: number;
    postsFailed: number;
    totalEarnedGSTD: number;
}

export interface StorageConfig {
    enabled: boolean;
    maxStorageGB: number;       // Max disk to contribute
    storageDir: string;         // Where to store shards
    postIntervalMs: number;     // PoSt challenge interval
}

const PLATFORM_API = process.env.GSTD_API_URL || 'https://app.gstdtoken.com/api/v1';
const DEFAULT_SHARD_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const POST_CHALLENGE_INTERVAL = 6 * 60 * 60 * 1000;  // 6 hours

// ─── Storage Vault ──────────────────────────────────────────────
export class StorageVault {
    private config: StorageConfig;
    private shards: Map<string, StorageShard> = new Map();
    private stats: StorageStats;
    private revenue: RevenueEngine | null = null;
    private postTimer: NodeJS.Timeout | null = null;
    private rewardTimer: NodeJS.Timeout | null = null;
    private nodeId: string;
    private startTime: number = Date.now();

    constructor(nodeId: string, config?: Partial<StorageConfig>) {
        this.nodeId = nodeId;
        this.config = {
            enabled: config?.enabled ?? (process.env.GSTD_STORAGE !== 'false'),
            maxStorageGB: config?.maxStorageGB ?? parseFloat(process.env.GSTD_STORAGE_MAX_GB || '50'),
            storageDir: config?.storageDir ?? join(homedir(), '.config', 'gstdbot', 'vault'),
            postIntervalMs: config?.postIntervalMs ?? POST_CHALLENGE_INTERVAL,
        };
        this.stats = {
            totalCapacityGB: this.config.maxStorageGB,
            usedGB: 0,
            availableGB: this.config.maxStorageGB,
            shardsStored: 0,
            uptimeHours: 0,
            postsCompleted: 0,
            postsFailed: 0,
            totalEarnedGSTD: 0,
        };
    }

    setRevenueEngine(rev: RevenueEngine): void {
        this.revenue = rev;
    }

    async init(): Promise<void> {
        if (!this.config.enabled) {
            console.log('    Storage Vault: disabled (set GSTD_STORAGE=true)');
            return;
        }

        // Create storage directory
        if (!existsSync(this.config.storageDir)) {
            mkdirSync(this.config.storageDir, { recursive: true });
        }

        // Load existing shards
        this.loadShards();

        // Register as storage provider with platform
        await this.registerProvider();

        // Start PoSt challenge responder
        this.postTimer = setInterval(() => {
            this.respondToPoStChallenges().catch(() => {});
        }, this.config.postIntervalMs);

        // Storage reward accumulation every hour
        this.rewardTimer = setInterval(() => {
            this.accumulateStorageRewards();
        }, 60 * 60 * 1000);

        // Poll for storage requests
        setInterval(() => {
            this.pollStorageRequests().catch(() => {});
        }, 30_000);

        logActivity(`Storage Vault: ${this.config.maxStorageGB} GB available, ${this.shards.size} shards loaded`, 'success');
    }

    async stop(): Promise<void> {
        if (this.postTimer) clearInterval(this.postTimer);
        if (this.rewardTimer) clearInterval(this.rewardTimer);
        this.saveShards();
    }

    // ─── Store a shard ──────────────────────────────────────────
    async storeShard(data: Buffer, metadata: {
        fileHash: string;
        shardIndex: number;
        totalShards: number;
        ownerNode: string;
        ttlMs?: number;
    }): Promise<StorageShard | null> {
        const sizeGB = data.length / (1024 * 1024 * 1024);
        if (this.stats.usedGB + sizeGB > this.config.maxStorageGB) {
            logActivity('Storage Vault: capacity exceeded, rejecting shard', 'error');
            return null;
        }

        const shardId = `shard_${metadata.fileHash.slice(0, 12)}_${metadata.shardIndex}`;
        const checksum = createHash('sha256').update(data).digest('hex');
        const now = new Date();

        const shard: StorageShard = {
            id: shardId,
            fileHash: metadata.fileHash,
            shardIndex: metadata.shardIndex,
            totalShards: metadata.totalShards,
            size: data.length,
            checksum,
            storedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + (metadata.ttlMs || DEFAULT_SHARD_TTL)).toISOString(),
            ownerNode: metadata.ownerNode,
            lastVerified: now.toISOString(),
            verified: true,
        };

        // Write to disk (encrypted at rest)
        const encKey = createHash('sha256').update(this.nodeId + shardId).digest();
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-cbc', encKey, iv);
        const encrypted = Buffer.concat([iv, cipher.update(data), cipher.final()]);

        writeFileSync(join(this.config.storageDir, shardId + '.shard'), encrypted);

        this.shards.set(shardId, shard);
        this.stats.usedGB += sizeGB;
        this.stats.availableGB = this.config.maxStorageGB - this.stats.usedGB;
        this.stats.shardsStored = this.shards.size;

        this.saveShards();
        logActivity(`Stored shard ${shardId} (${(data.length / 1024).toFixed(1)} KB)`, 'info');

        return shard;
    }

    // ─── Retrieve a shard ───────────────────────────────────────
    async retrieveShard(shardId: string): Promise<Buffer | null> {
        const shard = this.shards.get(shardId);
        if (!shard) return null;

        const filePath = join(this.config.storageDir, shardId + '.shard');
        if (!existsSync(filePath)) return null;

        try {
            const encrypted = readFileSync(filePath);
            const encKey = createHash('sha256').update(this.nodeId + shardId).digest();
            const iv = encrypted.subarray(0, 16);
            const ciphertext = encrypted.subarray(16);
            const decipher = createDecipheriv('aes-256-cbc', encKey, iv);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (_e) {
            return null;
        }
    }

    // ─── Proof-of-Storage (PoSt) ────────────────────────────────
    private async respondToPoStChallenges(): Promise<void> {
        if (this.shards.size === 0) return;

        try {
            // Ask platform for challenges
            const resp = await fetch(`${PLATFORM_API}/storage/challenges`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.nodeId,
                    shard_ids: Array.from(this.shards.keys()),
                }),
                signal: AbortSignal.timeout(10000),
            }).catch(() => null);

            if (!resp?.ok) {
                // Self-challenge (verify our own shards)
                await this.selfVerify();
                return;
            }

            const { challenges } = await resp.json() as any;
            if (!challenges?.length) return;

            const proofs: any[] = [];
            for (const challenge of challenges) {
                const shard = this.shards.get(challenge.shard_id);
                if (!shard) continue;

                const data = await this.retrieveShard(challenge.shard_id);
                if (!data) {
                    shard.verified = false;
                    this.stats.postsFailed++;
                    continue;
                }

                // Compute proof: hash(data + challenge_nonce)
                const proof = createHash('sha256')
                    .update(data)
                    .update(challenge.nonce || '')
                    .digest('hex');

                proofs.push({
                    shard_id: challenge.shard_id,
                    proof,
                    size: data.length,
                    checksum: shard.checksum,
                });

                shard.lastVerified = new Date().toISOString();
                shard.verified = true;
                this.stats.postsCompleted++;
            }

            // Submit proofs
            if (proofs.length > 0) {
                await fetch(`${PLATFORM_API}/storage/proofs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: this.nodeId,
                        proofs,
                    }),
                    signal: AbortSignal.timeout(10000),
                }).catch(() => {});

                logActivity(`PoSt: ${proofs.length}/${challenges.length} challenges passed ✓`, 'success');
            }
        } catch (_e) {
            await this.selfVerify();
        }
    }

    private async selfVerify(): Promise<void> {
        let passed = 0;
        let failed = 0;

        for (const [id, shard] of this.shards) {
            const data = await this.retrieveShard(id);
            if (data) {
                const checksum = createHash('sha256').update(data).digest('hex');
                if (checksum === shard.checksum) {
                    shard.verified = true;
                    shard.lastVerified = new Date().toISOString();
                    passed++;
                } else {
                    shard.verified = false;
                    failed++;
                }
            } else {
                shard.verified = false;
                failed++;
            }
        }

        this.stats.postsCompleted += passed;
        this.stats.postsFailed += failed;

        if (this.shards.size > 0) {
            logActivity(`Self-verify: ${passed}/${passed + failed} shards OK`, passed > 0 ? 'success' : 'error');
        }
    }

    // ─── Storage Rewards ────────────────────────────────────────
    private accumulateStorageRewards(): void {
        if (!this.revenue || this.stats.usedGB <= 0) return;

        // Earn GSTD for 1 hour of storage
        const event = this.revenue.earnStorage(this.stats.usedGB, 1);
        if (event.amount > 0) {
            this.stats.totalEarnedGSTD += event.amount;
        }
    }

    // ─── Poll for incoming storage requests ─────────────────────
    private async pollStorageRequests(): Promise<void> {
        if (this.stats.availableGB <= 0.1) return;

        try {
            const resp = await fetch(`${PLATFORM_API}/storage/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.nodeId,
                    available_gb: this.stats.availableGB,
                    shard_count: this.shards.size,
                }),
                signal: AbortSignal.timeout(5000),
            }).catch(() => null);

            if (resp?.ok) {
                const data = await resp.json() as any;
                if (data.shards?.length) {
                    for (const req of data.shards) {
                        // Download and store shard
                        try {
                            const shardResp = await fetch(req.download_url, {
                                signal: AbortSignal.timeout(30000),
                            });
                            if (shardResp.ok) {
                                const buf = Buffer.from(await shardResp.arrayBuffer());
                                await this.storeShard(buf, {
                                    fileHash: req.file_hash,
                                    shardIndex: req.shard_index,
                                    totalShards: req.total_shards,
                                    ownerNode: req.owner_node,
                                    ttlMs: req.ttl_ms,
                                });
                            }
                        } catch (_e) {}
                    }
                }
            }
        } catch (_e) {}
    }

    // ─── Platform Registration ──────────────────────────────────
    private async registerProvider(): Promise<void> {
        try {
            await fetch(`${PLATFORM_API}/storage/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node_id: this.nodeId,
                    capacity_gb: this.config.maxStorageGB,
                    available_gb: this.stats.availableGB,
                    shard_count: this.shards.size,
                }),
                signal: AbortSignal.timeout(5000),
            }).catch(() => {});
        } catch (_e) {}
    }

    // ─── Persistence ────────────────────────────────────────────
    private loadShards(): void {
        const indexFile = join(this.config.storageDir, 'index.json');
        if (existsSync(indexFile)) {
            try {
                const data = JSON.parse(readFileSync(indexFile, 'utf-8'));
                for (const s of data) {
                    // Verify shard file exists
                    if (existsSync(join(this.config.storageDir, s.id + '.shard'))) {
                        this.shards.set(s.id, s);
                        this.stats.usedGB += s.size / (1024 * 1024 * 1024);
                    }
                }
                this.stats.availableGB = this.config.maxStorageGB - this.stats.usedGB;
                this.stats.shardsStored = this.shards.size;
            } catch (_e) {}
        }
    }

    private saveShards(): void {
        try {
            writeFileSync(
                join(this.config.storageDir, 'index.json'),
                JSON.stringify(Array.from(this.shards.values()), null, 2)
            );
        } catch (_e) {}
    }

    // ─── Stats ──────────────────────────────────────────────────
    getStats(): StorageStats {
        this.stats.uptimeHours = (Date.now() - this.startTime) / 3600000;
        return { ...this.stats };
    }

    getShards(): StorageShard[] {
        return Array.from(this.shards.values());
    }

    isEnabled(): boolean {
        return this.config.enabled;
    }
}
