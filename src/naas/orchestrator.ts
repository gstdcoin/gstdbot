/**
 * GSTD NaaS — Master Orchestrator
 *
 * Entry point for the Node-as-a-Service subsystem.
 * Runs the full pipeline:
 *   1. Detect hardware
 *   2. Assign blockchain roles
 *   3. Launch chain node containers (Docker)
 *   4. Start Gas-Less RPC Proxy
 *   5. Start Revenue Flywheel
 *   6. Report to GSTD Platform + earn rewards
 */

import { execSync, spawn } from 'child_process';
import { HardwareDetector, RoleAssigner, AssignedRole } from './hardware_profiler.js';
import { GSTDRPCProxy }           from './rpc_proxy.js';
import { RevenueFlywheelConverter } from './revenue_flywheel.js';
import { logActivity }              from '../gateway/server.js';

const API_BASE = process.env.GSTD_API_URL || 'https://platform.gstdtoken.com/api/v1';

function isDockerAvailable(): boolean {
    try { execSync('docker info', { stdio: 'pipe', timeout: 5000 }); return true; }
    catch { return false; }
}

async function launchChainNode(role: AssignedRole): Promise<boolean> {
    if (!isDockerAvailable()) {
        logActivity(`Docker not available — skipping ${role.chain} container`, 'warn');
        return false;
    }

    const containerName = `gstd-naas-${role.chain.toLowerCase()}-${role.mode}`;
    const envArgs = Object.entries(role.envVars || {})
        .flatMap(([k, v]) => ['-e', `${k}=${v}`]);

    const cmd = [
        'docker', 'run', '-d',
        '--name', containerName,
        '--restart', 'unless-stopped',
        '--cpus', '2.0',
        '--memory', '4g',
        '-p', `${role.rpcPort}:${role.rpcPort}`,
        ...envArgs,
        '--label', `managed_by=gstd-naas`,
        '--label', `chain=${role.chain}`,
        role.dockerImage,
    ];

    try {
        // Check if already running
        const running = execSync(`docker ps -q --filter name=${containerName}`, { timeout: 5000 }).toString().trim();
        if (running) {
            logActivity(`  ✅ ${role.chain} (${role.mode}) already running`);
            return true;
        }

        // Pull image first (non-blocking)
        logActivity(`  ⬇️  Pulling ${role.dockerImage}...`);
        const pull = spawn('docker', ['pull', role.dockerImage], { stdio: 'inherit' });
        await new Promise<void>((resolve) => pull.on('close', () => resolve()));

        // Launch
        execSync(cmd.join(' '), { timeout: 30_000, stdio: 'pipe' });
        logActivity(`  🚀 ${role.chain} (${role.mode}) started on port :${role.rpcPort}`, 'success');
        return true;
    } catch (e: any) {
        logActivity(`  ❌ Failed to start ${role.chain}: ${e.message}`, 'error');
        return false;
    }
}

async function reportToGSTD(apiKey: string, roles: AssignedRole[], profile: any): Promise<void> {
    try {
        const resp = await fetch(`${API_BASE}/naas/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                provider_tier:     profile.tier,
                hardware:          profile,
                active_chains:     roles.map(r => ({ chain: r.chain, mode: r.mode, port: r.rpcPort })),
                rpc_proxy_port:    9000,
                node_version:      '1.0.0',
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (resp.ok) {
            const d: any = await resp.json();
            logActivity(`✅ Registered as NaaS Provider: ${d.provider_id || '?'} | Tier: ${profile.tier}`, 'success');
        }
    } catch { /* non-critical */ }
}

// ─── Main NaaS Manager ───────────────────────────────────────────
export class NaaSManager {
    private proxy:    GSTDRPCProxy | null = null;
    private flywheel: RevenueFlywheelConverter | null = null;
    private roles:    AssignedRole[] = [];

    async start(apiKey: string): Promise<void> {
        console.log('\n╔══════════════════════════════════════════════╗');
        console.log('║      🌐 GSTD NaaS — Multi-Chain Node         ║');
        console.log('║      Node-as-a-Service for top-50 chains     ║');
        console.log('╚══════════════════════════════════════════════╝\n');

        // ── Step 1: Detect hardware ──
        logActivity('🔍 Scanning hardware...');
        const detector = new HardwareDetector();
        const profile  = detector.detect();

        // ── Step 2: Assign roles ──
        logActivity('🎯 Assigning blockchain roles...');
        const assigner = new RoleAssigner();
        this.roles = assigner.assign(profile);
        assigner.summarize(this.roles, profile);

        if (this.roles.length === 0) {
            logActivity('⚠️  No roles assigned — insufficient hardware. Minimum: 2 CPU / 4GB RAM / 50GB disk', 'warn');
            return;
        }

        // ── Step 3: Launch containers ──
        logActivity('🐳 Launching chain node containers...');
        let launched = 0;
        for (const role of this.roles) {
            const ok = await launchChainNode(role);
            if (ok) launched++;
        }
        logActivity(`✅ ${launched}/${this.roles.length} chain nodes running`);

        // ── Step 4: Start RPC Proxy ──
        logActivity('🔌 Starting Gas-Less RPC Proxy on :9000...');
        this.proxy = new GSTDRPCProxy(9000);
        this.proxy.start();

        // ── Step 5: Start Revenue Flywheel ──
        logActivity('🔄 Starting Revenue Flywheel...');
        this.flywheel = new RevenueFlywheelConverter(apiKey);
        this.flywheel.start();

        // ── Step 6: Report to GSTD Platform ──
        await reportToGSTD(apiKey, this.roles, profile);

        logActivity('✅ GSTD NaaS fully operational!', 'success');
        logActivity(`   RPC Proxy: http://localhost:9000/rpc/{chain}`);
        logActivity(`   Chains: ${this.roles.map(r => r.chain).join(', ')}`);
        logActivity(`   Earnings: ~${this.roles.reduce((s, r) => s + r.estimatedReward, 0).toFixed(0)} GSTD/month estimated`);
    }

    stop(): void {
        this.proxy?.stop();
        this.flywheel?.stop();
    }

    getStatus() {
        return {
            active_chains:  this.roles.map(r => r.chain),
            rpc_proxy:      this.proxy?.getStats(),
            flywheel:       this.flywheel?.getStats(),
        };
    }
}
