/**
 * Order-independent task board. The state is a *set* of signed envelopes;
 * every view (task status, leases, results, entity history) is derived from
 * that set, so nodes that hold the same envelopes compute the same answer
 * regardless of the order in which gossip delivered them.
 */

import { z } from 'zod';
import { canonicalize, sha256Hex, verifyEnvelope, type Envelope } from './crypto.js';

export const ROLES = ['compute', 'data', 'verify', 'relay', 'archive'] as const;
export type Role = typeof ROLES[number];

const nanoString = z.string().regex(/^\d{1,30}$/);

export const ManifestSchema = z.object({
    kind: z.literal('data.fetch'),
    adapter: z.literal('npm-registry'),
    params: z.object({ package: z.string().regex(/^(@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,60}$/) }).strict(),
    entity: z.string().max(140),
    funding: z.enum(['commercial', 'subsidized']),
    budgetNano: nanoString,
    minVerifiers: z.number().int().min(1).max(5),
    leaseMs: z.number().int().min(500).max(3_600_000),
    deadline: z.number().int().positive(),
    maxAttempts: z.number().int().min(1).max(5),
    acceptance: z.literal('verifier-hash-match'),
    /** Nodes the publisher authorizes to coordinate the task if the publisher goes silent. */
    backups: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(3).optional(),
}).strict().refine(m => m.entity === `npm:${m.params.package}`, { message: 'entity must be npm:<package>' });
export type Manifest = z.infer<typeof ManifestSchema>;

const AnnounceSchema = z.object({
    roles: z.array(z.enum(ROLES)).max(5),
    adapters: z.array(z.string().max(32)).max(8),
    priceNano: nanoString,
    httpUrl: z.string().max(256).optional(),
    protocol: z.literal(1),
}).strict();
export type Announce = z.infer<typeof AnnounceSchema>;

const LeaseSchema = z.object({
    taskId: z.string().regex(/^[0-9a-f]{64}$/),
    role: z.enum(['data', 'verify']),
    worker: z.string().regex(/^[0-9a-f]{64}$/),
    epoch: z.number().int().min(1).max(10),
    expiresAt: z.number().int().positive(),
}).strict();
export type Lease = z.infer<typeof LeaseSchema>;

const VersionSchema = z.object({
    entity: z.string().max(140),
    adapter: z.string().max(32),
    source: z.string().max(300),
    fetchedAt: z.number().int().positive(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    content: z.unknown(),
}).strict();
export type DataVersion = z.infer<typeof VersionSchema>;

const ResultSchema = z.object({
    taskId: z.string().regex(/^[0-9a-f]{64}$/),
    leaseId: z.string().regex(/^[0-9a-f]{64}$/),
    version: VersionSchema,
}).strict();

const AttestSchema = z.object({
    taskId: z.string().regex(/^[0-9a-f]{64}$/),
    resultId: z.string().regex(/^[0-9a-f]{64}$/),
    verdict: z.enum(['match', 'mismatch', 'inconclusive']),
    observedHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    reason: z.string().max(200),
}).strict();

const FinalizeSchema = z.object({
    taskId: z.string().regex(/^[0-9a-f]{64}$/),
    decision: z.enum(['accepted', 'rejected']),
    reason: z.string().max(200),
    resultId: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict();

const SCHEMAS: Record<string, z.ZodTypeAny> = {
    'node.announce': AnnounceSchema,
    'task.publish': ManifestSchema,
    'task.lease': LeaseSchema,
    'task.result': ResultSchema,
    'task.attest': AttestSchema,
    'task.finalize': FinalizeSchema,
};

export type TaskStatus = 'unassigned' | 'leased' | 'awaiting-verification' | 'accepted' | 'rejected' | 'expired';

export interface Evaluation {
    status: TaskStatus;
    reason: string;
    resultId?: string;
    worker?: string;
    matchVerifiers: string[];
    mismatchVerifiers: string[];
    inconclusiveVerifiers: string[];
}

export interface ProofBundle {
    entity: string;
    taskId: string;
    envelopes: Envelope[];
}

export interface HistoryEntry {
    seq: number;
    taskId: string;
    resultId: string;
    contentHash: string;
    prevChainHash: string | null;
    chainHash: string;
    fetchedAt: number;
    source: string;
    observations: number;
    worker: string;
    verifiers: string[];
}

/** How long coordination must be silent before the first backup may take over. */
export function failoverMs(m: Manifest): number {
    return Math.max(5_000, 2 * m.leaseMs);
}

export class Board {
    private objects = new Map<string, Envelope>();

    /**
     * The publisher always coordinates. A backup named in the manifest may
     * coordinate only with envelopes stamped after the failover window opened.
     */
    private isCoordinator(m: Envelope<Manifest>, e: Envelope): boolean {
        if (e.signer === m.signer) return true;
        return (m.payload.backups ?? []).includes(e.signer) && e.ts >= m.ts + failoverMs(m.payload);
    }

    /** Latest valid coordinator activity; a silent publisher lets backups take over. */
    lastCoordinator(taskId: string): { ts: number; signer: string } | null {
        const m = this.manifest(taskId);
        if (!m) return null;
        let last = { ts: m.ts, signer: m.signer };
        for (const e of [...this.leases(taskId), ...this.finalizes(taskId)]) {
            if (e.ts > last.ts || (e.ts === last.ts && e.signer === m.signer)) last = { ts: e.ts, signer: e.signer };
        }
        return last;
    }

    has(id: string): boolean { return this.objects.has(id); }
    get(id: string): Envelope | undefined { return this.objects.get(id); }
    ids(): string[] { return [...this.objects.keys()].sort(); }
    all(): Envelope[] { return [...this.objects.values()]; }
    size(): number { return this.objects.size; }

    /** Structural validation only; authority is decided when views are derived. */
    ingest(env: unknown, now: number = Date.now()): { added: boolean; reason?: string } {
        const check = verifyEnvelope(env, now);
        if (!check.ok) return { added: false, reason: check.reason };
        const e = env as Envelope;
        if (this.objects.has(e.id)) return { added: false, reason: 'duplicate' };
        const schema = SCHEMAS[e.type];
        if (!schema) return { added: false, reason: 'unknown type' };
        const parsed = schema.safeParse(e.payload);
        if (!parsed.success) return { added: false, reason: `invalid payload: ${parsed.error.issues[0]?.message ?? 'schema'}` };
        if (e.type === 'task.result') {
            const v = (e.payload as z.infer<typeof ResultSchema>).version;
            let hash: string;
            try { hash = sha256Hex(canonicalize(v.content)); } catch { return { added: false, reason: 'content not canonicalizable' }; }
            if (hash !== v.contentHash) return { added: false, reason: 'content hash mismatch' };
        }
        this.objects.set(e.id, e);
        return { added: true };
    }

    private ofType<P>(type: string): Envelope<P>[] {
        return this.all().filter(e => e.type === type) as Envelope<P>[];
    }

    announces(): Map<string, Envelope<Announce>> {
        const latest = new Map<string, Envelope<Announce>>();
        for (const e of this.ofType<Announce>('node.announce')) {
            const cur = latest.get(e.signer);
            if (!cur || e.ts > cur.ts || (e.ts === cur.ts && e.id > cur.id)) latest.set(e.signer, e);
        }
        return latest;
    }

    taskIds(): string[] { return this.ofType<Manifest>('task.publish').map(e => e.id).sort(); }
    manifest(taskId: string): Envelope<Manifest> | undefined {
        const e = this.objects.get(taskId);
        return e && e.type === 'task.publish' ? e as Envelope<Manifest> : undefined;
    }

    /** Leases are only valid when signed by the publisher or an authorized, activated backup. */
    leases(taskId: string): Envelope<Lease>[] {
        const m = this.manifest(taskId);
        if (!m) return [];
        return this.ofType<Lease>('task.lease')
            .filter(l => l.payload.taskId === taskId && this.isCoordinator(m, l))
            .sort((a, b) => a.payload.epoch - b.payload.epoch || (a.id < b.id ? -1 : 1));
    }

    results(taskId: string): Envelope<z.infer<typeof ResultSchema>>[] {
        const m = this.manifest(taskId);
        if (!m) return [];
        const dataLeases = new Map(this.leases(taskId).filter(l => l.payload.role === 'data').map(l => [l.id, l]));
        return this.ofType<z.infer<typeof ResultSchema>>('task.result')
            .filter(r => {
                if (r.payload.taskId !== taskId) return false;
                const lease = dataLeases.get(r.payload.leaseId);
                if (!lease || lease.payload.worker !== r.signer) return false;
                const v = r.payload.version;
                return v.entity === m.payload.entity && v.adapter === m.payload.adapter;
            })
            .sort((a, b) => this.epochOf(a, dataLeases) - this.epochOf(b, dataLeases) || (a.id < b.id ? -1 : 1));
    }

    private epochOf(r: Envelope<z.infer<typeof ResultSchema>>, leases: Map<string, Envelope<Lease>>): number {
        return leases.get(r.payload.leaseId)?.payload.epoch ?? Number.MAX_SAFE_INTEGER;
    }

    attests(taskId: string, resultId: string): Envelope<z.infer<typeof AttestSchema>>[] {
        const result = this.objects.get(resultId);
        if (!result) return [];
        const verifyLeases = this.leases(taskId).filter(l => l.payload.role === 'verify');
        const seen = new Set<string>();
        const out: Envelope<z.infer<typeof AttestSchema>>[] = [];
        const candidates = this.ofType<z.infer<typeof AttestSchema>>('task.attest')
            .filter(a => a.payload.taskId === taskId && a.payload.resultId === resultId)
            .sort((a, b) => (a.id < b.id ? -1 : 1));
        for (const a of candidates) {
            if (a.signer === result.signer) continue; // a worker cannot verify itself
            if (!verifyLeases.some(l => l.payload.worker === a.signer)) continue;
            if (seen.has(a.signer)) continue; // one vote per verifier
            seen.add(a.signer);
            out.push(a);
        }
        return out;
    }

    finalizes(taskId: string): Envelope<z.infer<typeof FinalizeSchema>>[] {
        const m = this.manifest(taskId);
        if (!m) return [];
        return this.ofType<z.infer<typeof FinalizeSchema>>('task.finalize')
            .filter(f => f.payload.taskId === taskId && this.isCoordinator(m, f))
            .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
    }

    private tally(taskId: string, resultId: string) {
        const attests = this.attests(taskId, resultId);
        return {
            match: attests.filter(a => a.payload.verdict === 'match' && a.payload.observedHash === (this.objects.get(resultId) as Envelope<z.infer<typeof ResultSchema>>).payload.version.contentHash).map(a => a.signer),
            mismatch: attests.filter(a => a.payload.verdict === 'mismatch').map(a => a.signer),
            inconclusive: attests.filter(a => a.payload.verdict === 'inconclusive').map(a => a.signer),
        };
    }

    evaluate(taskId: string, now: number = Date.now()): Evaluation {
        const m = this.manifest(taskId);
        const empty = { matchVerifiers: [], mismatchVerifiers: [], inconclusiveVerifiers: [] };
        if (!m) return { status: 'unassigned', reason: 'manifest unknown', ...empty };
        const need = m.payload.minVerifiers;
        const results = this.results(taskId);

        const accepts = (resultId: string) => {
            const t = this.tally(taskId, resultId);
            return t.match.length >= need && t.match.length > t.mismatch.length ? t : null;
        };

        // A publisher-signed pin is honoured so late duplicate results cannot flip an accepted task.
        for (const f of this.finalizes(taskId)) {
            if (f.payload.decision === 'accepted' && f.payload.resultId && results.some(r => r.id === f.payload.resultId)) {
                const t = accepts(f.payload.resultId);
                if (t) return this.accepted(f.payload.resultId, t);
            }
        }
        for (const r of results) {
            const t = accepts(r.id);
            if (t) return this.accepted(r.id, t);
        }
        for (const r of results) {
            const t = this.tally(taskId, r.id);
            if (t.mismatch.length >= need && t.mismatch.length > t.match.length) {
                return {
                    status: 'rejected', reason: 'independent verifiers could not reproduce the result hash',
                    resultId: r.id, worker: r.signer,
                    matchVerifiers: t.match, mismatchVerifiers: t.mismatch, inconclusiveVerifiers: t.inconclusive,
                };
            }
        }
        if (now > m.payload.deadline) return { status: 'expired', reason: 'deadline passed without verified result', ...empty };
        if (results.length > 0) return { status: 'awaiting-verification', reason: 'result received, waiting for verifiers', resultId: results[0].id, worker: results[0].signer, ...empty };
        if (this.leases(taskId).some(l => l.payload.role === 'data')) return { status: 'leased', reason: 'executor leased', ...empty };
        return { status: 'unassigned', reason: 'no executor leased', ...empty };
    }

    private accepted(resultId: string, t: { match: string[]; mismatch: string[]; inconclusive: string[] }): Evaluation {
        return {
            status: 'accepted', reason: `${t.match.length} independent verifier(s) reproduced the content hash`,
            resultId, worker: this.objects.get(resultId)!.signer,
            matchVerifiers: [...t.match].sort(), mismatchVerifiers: [...t.mismatch].sort(), inconclusiveVerifiers: [...t.inconclusive].sort(),
        };
    }

    /** Version history per entity: accepted observations only, hash-chained. */
    history(entity: string): HistoryEntry[] {
        const observed: Array<{ taskId: string; ev: Evaluation; v: DataVersion }> = [];
        for (const taskId of this.taskIds()) {
            const m = this.manifest(taskId)!;
            if (m.payload.entity !== entity) continue;
            const ev = this.evaluate(taskId);
            if (ev.status !== 'accepted' || !ev.resultId) continue;
            const r = this.objects.get(ev.resultId) as Envelope<z.infer<typeof ResultSchema>>;
            observed.push({ taskId, ev, v: r.payload.version });
        }
        observed.sort((a, b) => a.v.fetchedAt - b.v.fetchedAt || (a.taskId < b.taskId ? -1 : 1));
        const out: HistoryEntry[] = [];
        for (const o of observed) {
            const last = out[out.length - 1];
            if (last && last.contentHash === o.v.contentHash) { last.observations++; continue; }
            const prev = last ? last.chainHash : null;
            out.push({
                seq: out.length + 1, taskId: o.taskId, resultId: o.ev.resultId!, contentHash: o.v.contentHash,
                prevChainHash: prev, chainHash: sha256Hex(`${prev ?? ''}|${o.v.contentHash}`),
                fetchedAt: o.v.fetchedAt, source: o.v.source, observations: 1,
                worker: o.ev.worker!, verifiers: o.ev.matchVerifiers,
            });
        }
        return out;
    }

    entities(): string[] {
        const set = new Set<string>();
        for (const taskId of this.taskIds()) {
            if (this.evaluate(taskId).status === 'accepted') set.add(this.manifest(taskId)!.payload.entity);
        }
        return [...set].sort();
    }

    contentOf(resultId: string): DataVersion | undefined {
        const r = this.objects.get(resultId) as Envelope<z.infer<typeof ResultSchema>> | undefined;
        return r?.type === 'task.result' ? r.payload.version : undefined;
    }

    proofBundle(taskId: string): ProofBundle | null {
        const m = this.manifest(taskId);
        const ev = this.evaluate(taskId);
        if (!m || ev.status !== 'accepted' || !ev.resultId) return null;
        const envs: Envelope[] = [m, ...this.leases(taskId), this.objects.get(ev.resultId)!, ...this.attests(taskId, ev.resultId), ...this.finalizes(taskId)];
        return { entity: m.payload.entity, taskId, envelopes: envs };
    }
}

/** Offline verification a client can run without trusting the node that served the data. */
export function verifyProofBundle(bundle: ProofBundle): { ok: boolean; reason: string; evaluation?: Evaluation } {
    const board = new Board();
    for (const e of bundle.envelopes) {
        const r = board.ingest(e);
        if (!r.added && r.reason !== 'duplicate') return { ok: false, reason: `invalid envelope in bundle: ${r.reason}` };
    }
    const ev = board.evaluate(bundle.taskId);
    if (ev.status !== 'accepted') return { ok: false, reason: `bundle does not prove acceptance (${ev.status}: ${ev.reason})`, evaluation: ev };
    return { ok: true, reason: ev.reason, evaluation: ev };
}
