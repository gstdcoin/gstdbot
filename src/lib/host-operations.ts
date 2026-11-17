import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const configPath = (name: string) => join(process.env.GSTD_CONFIG_DIR || join(homedir(), '.config/gstdbot'), name);

function readJson(path: string): unknown {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

function replaceJson(path: string, value: unknown): void {
    const temp = path + '.' + randomUUID();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
        writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        renameSync(temp, path);
    } finally {
        try { unlinkSync(temp); } catch { /* Already renamed or never created. */ }
    }
}

type MaintenanceWindow = { starts_at: number; ends_at: number };
let schedule: { path: string; window: MaintenanceWindow | null; error: boolean } | undefined;

export function parseMaintenance(value: unknown, now = Date.now()): MaintenanceWindow | null {
    if (value === null) return null;
    const input = value as Partial<MaintenanceWindow> | undefined;
    if (!input || !Number.isSafeInteger(input.starts_at) || !Number.isSafeInteger(input.ends_at)
        || input.starts_at! < 0 || input.starts_at! > now + 90 * 86400_000
        || input.ends_at! <= input.starts_at! || input.ends_at! - input.starts_at! > 7 * 86400_000) {
        throw new Error('invalid_maintenance_window');
    }
    return { starts_at: input.starts_at!, ends_at: input.ends_at! };
}

export function maintenanceStatus(now = Date.now()) {
    const path = configPath('maintenance-window.json');
    if (schedule?.path !== path) {
        try { schedule = { path, window: parseMaintenance(readJson(path), now), error: false }; }
        catch { schedule = { path, window: null, error: true }; }
    }
    const window = schedule.window;
    const active = schedule.error || !!(window && now >= window.starts_at && now < window.ends_at);
    return { window, active, storage_error: schedule.error };
}

export function setMaintenance(window: MaintenanceWindow | null): void {
    const path = configPath('maintenance-window.json');
    replaceJson(path, window);
    schedule = { path, window, error: false };
}

type TaskOutcome = 'result_submitted' | 'inference_failed' | 'submission_unconfirmed' | 'outcome_unknown';
type TaskSample = { key: string; at: number; outcome: TaskOutcome; elapsed_ms: number };
const historyLimit = 200;

export class TaskHistory {
    private readonly path: string;
    private samples: TaskSample[] = [];
    private storageError = false;

    constructor(nodeId: string) {
        const id = createHash('sha256').update(nodeId).digest('hex');
        this.path = configPath('task-history-' + id + '.json');
        try {
            const stored = readJson(this.path);
            if (stored !== null && !Array.isArray(stored)) throw new Error('invalid_task_history');
            if (Array.isArray(stored)) this.samples = stored.filter(sample =>
                sample && typeof sample.key === 'string' && /^[a-f0-9]{64}$/.test(sample.key)
                && Number.isSafeInteger(sample.at) && sample.at >= 0
                && Number.isSafeInteger(sample.elapsed_ms) && sample.elapsed_ms >= 0
                && ['result_submitted', 'inference_failed', 'submission_unconfirmed', 'outcome_unknown'].includes(sample.outcome),
            ).slice(-historyLimit);
        } catch { this.storageError = true; }
    }

    record(taskId: string, startedAt: number, outcome: TaskOutcome): void {
        const key = createHash('sha256').update(taskId).digest('hex');
        if (this.samples.some(sample => sample.key === key && sample.outcome === 'result_submitted')) return;
        const at = Date.now();
        this.samples = this.samples.filter(sample => sample.key !== key);
        this.samples.push({ key, at, elapsed_ms: Math.max(0, at - startedAt), outcome });
        this.samples = this.samples.slice(-historyLimit);
        try { replaceJson(this.path, this.samples); this.storageError = false; }
        catch { this.storageError = true; }
    }

    summary() {
        const count = (outcome: TaskOutcome) => this.samples.filter(sample => sample.outcome === outcome).length;
        return {
            total: this.samples.length,
            submitted: count('result_submitted'),
            inference_failed: count('inference_failed'),
            submission_unconfirmed: count('submission_unconfirmed'),
            outcome_unknown: count('outcome_unknown'),
            storage_error: this.storageError,
            recent: this.samples.slice(-20).reverse().map(({ at, outcome, elapsed_ms }) => ({ at, outcome, elapsed_ms })),
        };
    }
}
