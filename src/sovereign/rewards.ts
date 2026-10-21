/**
 * Deterministic internal reward accounting + local payout simulator.
 *
 * Nothing here moves funds. Entries are "accrued" and can only reach
 * "simulated-settled"; real settlement is intentionally unreachable from this
 * module (see docs/SOVEREIGN_ECONOMICS.md).
 *
 * Eligibility is limited to proven work on an accepted task: executing the
 * accepted result and independently reproducing it. Heartbeats, registration
 * and hardware earn nothing.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { sha256Hex, canonicalize } from './crypto.js';
import type { Board, Manifest } from './board.js';

export interface RewardParams {
    /** Share of a task budget that goes to node operators. 85% is what SettlementMaster.tact initialises; deployed bytecode is unverified. */
    operatorShareBps: number;
    executionShareBps: number; // of the operator pool
    verificationShareBps: number; // of the operator pool; split among matching verifiers
    /** Max share of the operator pool any single node can receive on one task. */
    perNodeCapBps: number;
    /** Hard cap on all subsidized accruals. Commercial tasks are funded by their own budget. */
    subsidyBudgetNano: bigint;
}

export const DEFAULT_PARAMS: RewardParams = {
    operatorShareBps: 8500,
    executionShareBps: 7000,
    verificationShareBps: 3000,
    perNodeCapBps: 7000,
    subsidyBudgetNano: 0n,
};

export type AccrualRole = 'execute' | 'verify';
export type PayoutState = 'accrued' | 'simulated-settled';

export interface Accrual {
    accrualId: string;
    taskId: string;
    resultId: string;
    node: string;
    role: AccrualRole;
    funding: 'commercial' | 'subsidized';
    declaredBudgetNano: string;
    amountNano: string;
    reason: string;
    verification: 'verifier-hash-match';
    resourceUse: null; // not measured in this slice; never invented
    state: PayoutState;
}

const BPS = 10_000n;

export function accrualId(taskId: string, resultId: string, node: string, role: AccrualRole): string {
    return sha256Hex(canonicalize({ taskId, resultId, node, role }));
}

/** Pure function of (manifest, evaluation, params): anyone can recompute and compare. */
export function computeAccruals(taskId: string, board: Board, params: RewardParams = DEFAULT_PARAMS): Accrual[] {
    const m = board.manifest(taskId);
    const ev = board.evaluate(taskId);
    if (!m || ev.status !== 'accepted' || !ev.resultId || !ev.worker) return [];
    const manifest: Manifest = m.payload;
    const publisher = m.signer;
    const coordinators = new Set([publisher, ...(manifest.backups ?? [])]);

    const budget = BigInt(manifest.budgetNano);
    const pool = budget * BigInt(params.operatorShareBps) / BPS;
    const cap = pool * BigInt(params.perNodeCapBps) / BPS;

    // Self-dealing: a coordinator of a task does not collect operator rewards from it.
    const executorEligible = !coordinators.has(ev.worker);
    const verifiers = ev.matchVerifiers.filter(v => !coordinators.has(v) && v !== ev.worker);

    const execPool = pool * BigInt(params.executionShareBps) / BPS;
    const verifyPool = pool * BigInt(params.verificationShareBps) / BPS;
    const min = (a: bigint, b: bigint) => (a < b ? a : b);

    const make = (node: string, role: AccrualRole, amount: bigint, reason: string): Accrual => ({
        accrualId: accrualId(taskId, ev.resultId!, node, role), taskId, resultId: ev.resultId!, node, role,
        funding: manifest.funding, declaredBudgetNano: manifest.budgetNano, amountNano: amount.toString(), reason,
        verification: 'verifier-hash-match', resourceUse: null, state: 'accrued',
    });

    const out: Accrual[] = [];
    if (executorEligible && execPool > 0n) out.push(make(ev.worker, 'execute', min(execPool, cap), 'result reproduced by independent verifiers'));
    if (verifiers.length > 0 && verifyPool > 0n) {
        const each = verifyPool / BigInt(verifiers.length); // remainder is left unallocated, never minted
        if (each > 0n) for (const v of [...verifiers].sort()) out.push(make(v, 'verify', min(each, cap), 'independently reproduced the result hash'));
    }
    return out;
}

export interface ApplyResult { applied: Accrual[]; skipped: Array<{ accrualId: string; reason: string }> }

export class Ledger {
    private entries = new Map<string, Accrual>();
    private taskSettled = new Set<string>();
    private subsidySpent = 0n;

    constructor(private readonly file: string | null, private readonly params: RewardParams = DEFAULT_PARAMS) {
        if (file) {
            mkdirSync(dirname(file), { recursive: true });
            if (existsSync(file)) {
                for (const line of readFileSync(file, 'utf-8').split('\n')) {
                    if (!line.trim()) continue;
                    try { this.load(JSON.parse(line) as Accrual); } catch { /* ignore a torn final line */ }
                }
            }
        }
    }

    private load(a: Accrual): void {
        this.entries.set(a.accrualId, a);
        this.taskSettled.add(a.taskId);
        if (a.funding === 'subsidized') this.subsidySpent += BigInt(a.amountNano);
    }

    /** Idempotent: a task is accrued at most once, and an accrualId at most once. */
    apply(accruals: Accrual[]): ApplyResult {
        const applied: Accrual[] = [];
        const skipped: ApplyResult['skipped'] = [];
        for (const a of accruals) {
            if (this.entries.has(a.accrualId)) { skipped.push({ accrualId: a.accrualId, reason: 'duplicate accrual' }); continue; }
            if (this.taskSettled.has(a.taskId) && ![...this.entries.values()].some(e => e.taskId === a.taskId && e.resultId === a.resultId)) {
                skipped.push({ accrualId: a.accrualId, reason: 'task already accrued for a different result' }); continue;
            }
            if (a.funding === 'subsidized' && this.subsidySpent + BigInt(a.amountNano) > this.params.subsidyBudgetNano) {
                skipped.push({ accrualId: a.accrualId, reason: 'subsidy budget exhausted' }); continue;
            }
            this.load(a);
            if (this.file) appendFileSync(this.file, JSON.stringify(a) + '\n');
            applied.push(a);
        }
        return { applied, skipped };
    }

    accrueTask(taskId: string, board: Board): ApplyResult {
        return this.apply(computeAccruals(taskId, board, this.params));
    }

    list(): Accrual[] { return [...this.entries.values()].sort((a, b) => (a.accrualId < b.accrualId ? -1 : 1)); }
    totalFor(node: string): bigint { return this.list().filter(a => a.node === node).reduce((s, a) => s + BigInt(a.amountNano), 0n); }
    subsidyRemaining(): bigint { return this.params.subsidyBudgetNano - this.subsidySpent; }
}

/** Local payout simulator: groups accrued entries per node. It never produces a transfer. */
export function simulatePayout(ledger: Ledger): { perNode: Record<string, string>; entries: number; realTransfersExecuted: 0 } {
    const perNode: Record<string, bigint> = {};
    for (const a of ledger.list()) if (a.state === 'accrued') perNode[a.node] = (perNode[a.node] ?? 0n) + BigInt(a.amountNano);
    return {
        perNode: Object.fromEntries(Object.entries(perNode).map(([k, v]) => [k, v.toString()])),
        entries: ledger.list().length,
        realTransfersExecuted: 0,
    };
}
