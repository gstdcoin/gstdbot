/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Task Scheduler (cron-like)
 * 
 * OpenClaw has cron + wakeups — GSTD goes further:
 *  - Cron-like scheduling for automated node tasks
 *  - Auto-claim rewards
 *  - Auto-backup memory
 *  - Auto-update check
 *  - Health watch + auto-restart
 *  - Swarm task polling
 * ═══════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';

export interface ScheduledTask {
    id: string;
    name: string;
    interval: number; // ms
    lastRun: string | null;
    nextRun: string;
    enabled: boolean;
    runCount: number;
    lastError: string | null;
    category: 'system' | 'swarm' | 'maintenance' | 'defi';
}

interface InternalTask extends ScheduledTask {
    fn: () => Promise<void>;
    timer: NodeJS.Timeout | null;
}

export class Scheduler extends EventEmitter {
    private tasks = new Map<string, InternalTask>();

    /** Register a recurring task */
    register(id: string, config: {
        name: string;
        interval: number;
        category: ScheduledTask['category'];
        enabled?: boolean;
        fn: () => Promise<void>;
    }) {
        const task: InternalTask = {
            id,
            name: config.name,
            interval: config.interval,
            lastRun: null,
            nextRun: new Date(Date.now() + config.interval).toISOString(),
            enabled: config.enabled !== false,
            runCount: 0,
            lastError: null,
            category: config.category,
            fn: config.fn,
            timer: null,
        };
        this.tasks.set(id, task);
    }

    /** Start all enabled tasks */
    startAll() {
        this.tasks.forEach(task => {
            if (task.enabled && !task.timer) {
                this.scheduleTask(task);
            }
        });
        console.log(`  ⏰ Scheduler: ${this.tasks.size} tasks registered`);
    }

    private scheduleTask(task: InternalTask) {
        // Run immediately then at interval
        setTimeout(() => this.runTask(task), 5000 + Math.random() * 5000); // Stagger starts

        task.timer = setInterval(() => this.runTask(task), task.interval);
    }

    private async runTask(task: InternalTask) {
        if (!task.enabled) return;
        try {
            await task.fn();
            task.lastRun = new Date().toISOString();
            task.nextRun = new Date(Date.now() + task.interval).toISOString();
            task.runCount++;
            task.lastError = null;
            this.emit('task:complete', { id: task.id, name: task.name });
        } catch (e: any) {
            task.lastError = e.message;
            task.lastRun = new Date().toISOString();
            task.nextRun = new Date(Date.now() + task.interval).toISOString();
            this.emit('task:error', { id: task.id, name: task.name, error: e.message });
        }
    }

    /** Enable/disable a task */
    setEnabled(id: string, enabled: boolean) {
        const task = this.tasks.get(id);
        if (!task) return false;
        task.enabled = enabled;
        if (!enabled && task.timer) {
            clearInterval(task.timer);
            task.timer = null;
        } else if (enabled && !task.timer) {
            this.scheduleTask(task);
        }
        return true;
    }

    /** Run a specific task now */
    async runNow(id: string): Promise<boolean> {
        const task = this.tasks.get(id);
        if (!task) return false;
        await this.runTask(task);
        return true;
    }

    /** Get all tasks status */
    getTasks(): ScheduledTask[] {
        return Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            name: t.name,
            interval: t.interval,
            lastRun: t.lastRun,
            nextRun: t.nextRun,
            enabled: t.enabled,
            runCount: t.runCount,
            lastError: t.lastError,
            category: t.category,
        }));
    }

    stop() {
        this.tasks.forEach(t => {
            if (t.timer) clearInterval(t.timer);
        });
    }
}
