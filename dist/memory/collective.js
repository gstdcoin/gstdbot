"use strict";
/**
 * GSTD Node OS — Collective Memory
 *
 * Multi-layer distributed knowledge store:
 *   L1: In-memory Map  (instant, per-node)
 *   L2: Redis          (shared across local services, optional)
 *   L3: Platform API   (global swarm knowledge)
 *
 * When a node answers a query with high confidence,
 * the answer gets stored and synced across the network.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectiveMemory = void 0;
const crypto_1 = require("crypto");
const server_js_1 = require("../gateway/server.js");
// ─── Collective Memory ──────────────────────────────────────────
class CollectiveMemory {
    config;
    l1 = new Map();
    redisClient = null;
    l2Connected = false;
    l3Connected = false;
    stats = { totalRecalls: 0, totalStores: 0, hits: 0 };
    L1_MAX = 10_000;
    L1_TTL = 24 * 60 * 60 * 1000; // 24h
    L2_TTL = 7 * 24 * 60 * 60; // 7 days (seconds for Redis)
    constructor(config) {
        this.config = config;
    }
    async init() {
        // Try to connect to Redis (L2)
        if (this.config.memory.enabled) {
            await this.connectRedis();
        }
        // Check platform API availability (L3)
        await this.checkPlatform();
        // Cleanup timer for L1 expired entries
        setInterval(() => this.cleanupL1(), 60_000);
        const status = [];
        status.push(`L1: ${this.l1.size} entries`);
        if (this.l2Connected)
            status.push('L2: Redis ✓');
        if (this.l3Connected)
            status.push('L3: Platform ✓');
        console.log('    Memory layers: ' + status.join(' | '));
    }
    async close() {
        if (this.redisClient) {
            try {
                await this.redisClient.quit();
            }
            catch (_e) { }
        }
    }
    isConnected() {
        return this.l2Connected || this.l3Connected;
    }
    getEntryCount() {
        return this.l1.size;
    }
    getStats() {
        return {
            l1Entries: this.l1.size,
            l2Connected: this.l2Connected,
            l3Connected: this.l3Connected,
            totalRecalls: this.stats.totalRecalls,
            totalStores: this.stats.totalStores,
            hitRate: this.stats.totalRecalls > 0
                ? Math.round((this.stats.hits / this.stats.totalRecalls) * 100)
                : 0,
        };
    }
    // ─── Store ────────────────────────────────────────────────────
    async store(question, answer, model, confidence, sources = []) {
        const key = this.hashKey(question);
        const now = new Date();
        const entry = {
            key,
            question: question.slice(0, 500),
            answer,
            model,
            confidence: Math.max(0, Math.min(1, confidence)),
            verifiedBy: 1,
            sources,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + this.L1_TTL).toISOString(),
            nodeId: this.config.nodeId,
            hits: 0,
        };
        // L1: Always store in memory
        if (this.l1.size >= this.L1_MAX) {
            // Evict oldest entry
            const oldest = Array.from(this.l1.entries())
                .sort((a, b) => a[1].hits - b[1].hits)[0];
            if (oldest)
                this.l1.delete(oldest[0]);
        }
        this.l1.set(key, entry);
        // L2: Store in Redis if available
        if (this.l2Connected) {
            try {
                await this.redisClient.setEx(`gstd:mem:${key}`, this.L2_TTL, JSON.stringify(entry));
            }
            catch (_e) { }
        }
        // L3: Report to platform for global sync (high confidence only)
        if (this.l3Connected && confidence >= 0.8) {
            this.syncToPlatform(entry).catch(() => { });
        }
        this.stats.totalStores++;
    }
    // ─── Recall ──────────────────────────────────────────────────
    async recall(question) {
        const key = this.hashKey(question);
        this.stats.totalRecalls++;
        // L1: Check in-memory first (fastest)
        const l1Entry = this.l1.get(key);
        if (l1Entry && !this.isExpired(l1Entry)) {
            l1Entry.hits++;
            this.stats.hits++;
            return l1Entry;
        }
        // L2: Check Redis
        if (this.l2Connected) {
            try {
                const raw = await this.redisClient.get(`gstd:mem:${key}`);
                if (raw) {
                    const entry = JSON.parse(raw);
                    entry.hits++;
                    this.l1.set(key, entry); // Promote to L1
                    this.stats.hits++;
                    return entry;
                }
            }
            catch (_e) { }
        }
        // L3: Check platform API
        if (this.l3Connected) {
            try {
                const resp = await fetch(`${this.config.swarm.apiUrl}/memory/recall`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        key,
                        question: question.slice(0, 500),
                        node_id: this.config.nodeId,
                    }),
                    signal: AbortSignal.timeout(5000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data?.answer) {
                        const entry = {
                            key,
                            question: question.slice(0, 500),
                            answer: data.answer,
                            model: data.model || 'platform',
                            confidence: data.confidence || 0.9,
                            verifiedBy: data.verified_by || 1,
                            sources: data.sources || [],
                            createdAt: data.created_at || new Date().toISOString(),
                            expiresAt: new Date(Date.now() + this.L1_TTL).toISOString(),
                            nodeId: data.node_id || 'platform',
                            hits: 1,
                        };
                        this.l1.set(key, entry); // Cache locally
                        this.stats.hits++;
                        return entry;
                    }
                }
            }
            catch (_e) { }
        }
        return null;
    }
    // ─── Verify ──────────────────────────────────────────────────
    async verify(question, expectedAnswer) {
        const existing = await this.recall(question);
        if (!existing)
            return false;
        // Simple similarity check
        const similarity = this.textSimilarity(existing.answer, expectedAnswer);
        if (similarity > 0.7) {
            existing.verifiedBy++;
            existing.confidence = Math.min(1, existing.confidence + 0.05);
            this.l1.set(existing.key, existing);
            return true;
        }
        return false;
    }
    // ─── Semantic Search (basic) ─────────────────────────────────
    async search(query, limit = 5) {
        const results = [];
        const queryLower = query.toLowerCase();
        const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));
        for (const entry of this.l1.values()) {
            if (this.isExpired(entry))
                continue;
            const text = (entry.question + ' ' + entry.answer).toLowerCase();
            let score = 0;
            for (const word of queryWords) {
                if (text.includes(word))
                    score++;
            }
            if (score > 0) {
                results.push({ entry, score: score / queryWords.size });
            }
        }
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(r => r.entry);
    }
    // ─── Private Helpers ─────────────────────────────────────────
    hashKey(text) {
        return (0, crypto_1.createHash)('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 24);
    }
    isExpired(entry) {
        return new Date(entry.expiresAt).getTime() < Date.now();
    }
    textSimilarity(a, b) {
        const setA = new Set(a.toLowerCase().split(/\s+/));
        const setB = new Set(b.toLowerCase().split(/\s+/));
        let common = 0;
        for (const w of setA)
            if (setB.has(w))
                common++;
        return common / Math.max(setA.size, setB.size, 1);
    }
    cleanupL1() {
        const now = Date.now();
        for (const [key, entry] of this.l1) {
            if (new Date(entry.expiresAt).getTime() < now) {
                this.l1.delete(key);
            }
        }
    }
    async connectRedis() {
        try {
            // Dynamic import for optional dependency
            const redis = await import('redis').catch(() => null);
            if (!redis) {
                console.log('    Redis module not installed (optional)');
                return;
            }
            this.redisClient = redis.createClient({ url: this.config.memory.redisUrl });
            this.redisClient.on('error', () => { this.l2Connected = false; });
            await this.redisClient.connect();
            await this.redisClient.ping();
            this.l2Connected = true;
            (0, server_js_1.logActivity)('Redis connected (L2 memory)', 'success');
        }
        catch (_e) {
            console.log('    Redis not available — using L1 + L3 only');
        }
    }
    async checkPlatform() {
        try {
            const resp = await fetch(`${this.config.swarm.apiUrl}/memory/ping`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
            this.l3Connected = resp?.ok || false;
        }
        catch (_e) {
            this.l3Connected = false;
        }
    }
    async syncToPlatform(entry) {
        try {
            await fetch(`${this.config.swarm.apiUrl}/memory/store`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: entry.key,
                    question: entry.question,
                    answer: entry.answer,
                    model: entry.model,
                    confidence: entry.confidence,
                    node_id: this.config.nodeId,
                }),
                signal: AbortSignal.timeout(5000),
            });
        }
        catch (_e) { }
    }
}
exports.CollectiveMemory = CollectiveMemory;
//# sourceMappingURL=collective.js.map