/**
 * OfflineQueue — local SQLite task queue for autonomous node operation.
 *
 * When platform is unreachable, training tasks are queued locally and
 * executed as soon as resources are available. Results are submitted
 * to the platform when connectivity is restored.
 *
 * Steiniger principle: node must function autonomously even when isolated.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface QueuedTask {
    id: string;
    type: string;
    payload: Record<string, any>;
    priority: number;
    createdAt: number;
    attempts: number;
    lastAttempt: number | null;
    status: 'pending' | 'running' | 'done' | 'failed';
    result: string | null;
}

export class OfflineQueue {
    private db: any = null;
    private dbPath: string;
    private ready = false;

    constructor(dataDir?: string) {
        const dir = dataDir || join(require('os').homedir(), '.config', 'gstdbot', 'queue');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.dbPath = join(dir, 'tasks.db');
    }

    async init(): Promise<void> {
        try {
            // Try to use better-sqlite3 if available
            const Database = require('better-sqlite3');
            this.db = new Database(this.dbPath);
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    priority INTEGER DEFAULT 5,
                    created_at INTEGER NOT NULL,
                    attempts INTEGER DEFAULT 0,
                    last_attempt INTEGER,
                    status TEXT DEFAULT 'pending',
                    result TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
                CREATE INDEX IF NOT EXISTS idx_priority ON tasks(priority DESC, created_at ASC);
            `);
            this.ready = true;
            console.log('    OfflineQueue: SQLite ready at ' + this.dbPath);
        } catch (_e) {
            // better-sqlite3 not available — use in-memory fallback
            console.log('    OfflineQueue: using in-memory fallback (install better-sqlite3 for persistence)');
            this.db = new InMemoryFallback();
            this.ready = true;
        }
    }

    enqueue(task: Omit<QueuedTask, 'attempts' | 'lastAttempt' | 'status' | 'result'>): void {
        if (!this.ready) return;
        try {
            this.db.enqueue({
                ...task,
                payload: typeof task.payload === 'string' ? task.payload : JSON.stringify(task.payload),
                attempts: 0,
                lastAttempt: null,
                status: 'pending',
                result: null,
            });
        } catch (_e) {}
    }

    dequeue(type?: string): QueuedTask | null {
        if (!this.ready) return null;
        try {
            return this.db.dequeue(type) || null;
        } catch (_e) { return null; }
    }

    complete(id: string, result: any): void {
        if (!this.ready) return;
        try {
            this.db.setStatus(id, 'done', typeof result === 'string' ? result : JSON.stringify(result));
        } catch (_e) {}
    }

    fail(id: string, error: string): void {
        if (!this.ready) return;
        try {
            this.db.setStatus(id, 'failed', error);
        } catch (_e) {}
    }

    pendingCount(type?: string): number {
        if (!this.ready) return 0;
        try {
            return this.db.count(type) || 0;
        } catch (_e) { return 0; }
    }

    pendingResults(): QueuedTask[] {
        if (!this.ready) return [];
        try {
            return this.db.getDone() || [];
        } catch (_e) { return []; }
    }

    markResultSubmitted(id: string): void {
        if (!this.ready) return;
        try {
            this.db.delete(id);
        } catch (_e) {}
    }
}

// ─── In-memory fallback (no SQLite) ──────────────────────────────
class InMemoryFallback {
    private tasks: Map<string, any> = new Map();

    enqueue(task: any): void {
        this.tasks.set(task.id, task);
    }

    dequeue(type?: string): any {
        for (const [id, task] of this.tasks) {
            if (task.status === 'pending' && (!type || task.type === type)) {
                task.status = 'running';
                task.attempts++;
                task.last_attempt = Date.now();
                return { ...task, payload: JSON.parse(task.payload || '{}') };
            }
        }
        return null;
    }

    setStatus(id: string, status: string, result: string): void {
        const task = this.tasks.get(id);
        if (task) { task.status = status; task.result = result; }
    }

    count(type?: string): number {
        let n = 0;
        for (const task of this.tasks.values()) {
            if (task.status === 'pending' && (!type || task.type === type)) n++;
        }
        return n;
    }

    getDone(): any[] {
        return Array.from(this.tasks.values()).filter(t => t.status === 'done');
    }

    delete(id: string): void {
        this.tasks.delete(id);
    }
}
