/**
 * GSTD Node License System
 * ════════════════════════════════════════════════════════
 * 
 * Instead of separate Docker containers for each blockchain,
 * the GSTD node itself is the product. All capabilities are modules
 * activated with GSTD proportional to the server performance.
 *
 * Cost Formula:
 *   moduleCost = basePrice × hardwareMultiplier × durationDays
 *
 * Higher performance server = more modules available,
 * higher license cost, but also higher potential income.
 *
 * Modules:
 *   🧠 AI Inference    — Handles AI queries (Ollama — sovereign local inference)
 *   📡 Traffic Relay   — Proxies traffic (VPN/CDN)
 *   💾 Storage Vault   — Stores network data
 *   💻 Compute Pool    — Performs computing tasks
 *   🌐 RPC Gateway     — Serves RCP requests for blockchains
 *   🎓 Model Training  — Participates in model training
 *   🔗 Bridge Relay    — Validates cross-chain transactions
 *
 * Tiers are automatically calculated by hardware.
 * User stakes GSTD → modules activate → node earns.
 */

import { HardwareDetector, HardwareProfile } from './hardware_profiler.js';


// ─── Module Definitions ─────────────────────────────────────────
export interface NodeModule {
    id: string;
    name: string;
    icon: string;
    description: string;
    // Hardware requirements
    minCpu: number;
    minRamGb: number;
    minDiskGb: number;
    needsGpu: boolean;
    // GSTD economics
    basePriceGSTD: number;      // monthly base price in GSTD
    earnMultiplier: number;     // how much this module earns vs base rate
    // Revenue share from this module
    revenueSharePercent: number; // % of module revenue going to node operator
}

export const NODE_MODULES: NodeModule[] = [
    {
        id: 'ai_inference',
        name: 'AI Inference',
        icon: '🧠',
        description: 'Answer AI queries using Ollama (sovereign, local inference)',
        minCpu: 2, minRamGb: 4, minDiskGb: 10, needsGpu: false,
        basePriceGSTD: 50,
        earnMultiplier: 3.0,
        revenueSharePercent: 85,
    },
    {
        id: 'traffic_relay',
        name: 'Traffic Relay',
        icon: '📡',
        description: 'Proxy network traffic (VPN/CDN/API relay)',
        minCpu: 1, minRamGb: 1, minDiskGb: 5, needsGpu: false,
        basePriceGSTD: 20,
        earnMultiplier: 1.5,
        revenueSharePercent: 90,
    },
    {
        id: 'storage_vault',
        name: 'Storage Vault',
        icon: '💾',
        description: 'Store and serve sharded blockchain/network data',
        minCpu: 1, minRamGb: 2, minDiskGb: 50, needsGpu: false,
        basePriceGSTD: 30,
        earnMultiplier: 2.0,
        revenueSharePercent: 88,
    },
    {
        id: 'compute_pool',
        name: 'Compute Pool',
        icon: '💻',
        description: 'Execute compute tasks (rendering, simulation, data processing)',
        minCpu: 4, minRamGb: 8, minDiskGb: 20, needsGpu: false,
        basePriceGSTD: 80,
        earnMultiplier: 4.0,
        revenueSharePercent: 82,
    },
    {
        id: 'rpc_gateway',
        name: 'RPC Gateway',
        icon: '🌐',
        description: 'Serve multi-chain RPC requests (ETH/SOL/TON/BTC...)',
        minCpu: 2, minRamGb: 4, minDiskGb: 30, needsGpu: false,
        basePriceGSTD: 100,
        earnMultiplier: 5.0,
        revenueSharePercent: 80,
    },
    {
        id: 'model_training',
        name: 'Model Training',
        icon: '🎓',
        description: 'Participate in federated model training jobs',
        minCpu: 8, minRamGb: 16, minDiskGb: 50, needsGpu: false,
        basePriceGSTD: 200,
        earnMultiplier: 8.0,
        revenueSharePercent: 75,
    },
    {
        id: 'bridge_relay',
        name: 'Bridge Relay',
        icon: '🔗',
        description: 'Validate and relay cross-chain bridge transactions',
        minCpu: 2, minRamGb: 4, minDiskGb: 20, needsGpu: false,
        basePriceGSTD: 150,
        earnMultiplier: 6.0,
        revenueSharePercent: 78,
    },
    {
        id: 'gpu_render',
        name: 'GPU Rendering',
        icon: '🎨',
        description: 'GPU-accelerated rendering and AI inference',
        minCpu: 4, minRamGb: 8, minDiskGb: 30, needsGpu: true,
        basePriceGSTD: 500,
        earnMultiplier: 15.0,
        revenueSharePercent: 70,
    },
];

// ─── Hardware Multiplier ────────────────────────────────────────
//
// Higher performance server = higher license cost multiplier,
// BUT also higher potential income.
//
// Formula: hardwareMultiplier = (cpu_score + ram_score + disk_score + gpu_score) / 4
//
function calculateHardwareMultiplier(profile: HardwareProfile): number {
    const cpuScore  = Math.min(profile.cpu_cores / 4, 4.0);   // 4 cores = 1.0x, 16 = 4.0x cap
    const ramScore  = Math.min(profile.ram_gb / 8, 4.0);      // 8GB = 1.0x, 32GB = 4.0x cap
    const diskScore = Math.min(profile.disk_gb / 100, 3.0);   // 100GB = 1.0x, 300GB = 3.0x cap
    const gpuScore  = profile.has_gpu ? (1.0 + profile.gpu_vram_gb / 8) : 0.5; // GPU bonus

    return Math.round(((cpuScore + ramScore + diskScore + gpuScore) / 4) * 100) / 100;
}

// ─── License Tier ───────────────────────────────────────────────
export interface LicenseTier {
    name: string;
    icon: string;
    color: string;
    minMultiplier: number;
    maxMultiplier: number;
    maxModules: number;
    stakingBonus: number;  // extra % on top of module earnings
}

const LICENSE_TIERS: LicenseTier[] = [
    { name: 'Spark',      icon: '⚡', color: '#888',    minMultiplier: 0,    maxMultiplier: 0.75, maxModules: 2, stakingBonus: 0 },
    { name: 'Flame',      icon: '🔥', color: '#ff6b35', minMultiplier: 0.75, maxMultiplier: 1.5,  maxModules: 4, stakingBonus: 5 },
    { name: 'Storm',      icon: '⛈️', color: '#4ecdc4', minMultiplier: 1.5,  maxMultiplier: 2.5,  maxModules: 6, stakingBonus: 15 },
    { name: 'Titan',      icon: '🏔️', color: '#ffd700', minMultiplier: 2.5,  maxMultiplier: 4.0,  maxModules: 8, stakingBonus: 30 },
    { name: 'Sovereign',  icon: '👑', color: '#e040fb', minMultiplier: 4.0,  maxMultiplier: 99,   maxModules: 99, stakingBonus: 50 },
];

function getTierForMultiplier(mult: number): LicenseTier {
    for (let i = LICENSE_TIERS.length - 1; i >= 0; i--) {
        if (mult >= LICENSE_TIERS[i].minMultiplier) return LICENSE_TIERS[i];
    }
    return LICENSE_TIERS[0];
}

// ─── License Manager ────────────────────────────────────────────
export interface ActivatedModule {
    module: NodeModule;
    monthlyCostGSTD: number;
    estimatedEarningsGSTD: number; // per month
    roi: number; // earnings / cost ratio
}

export interface NodeLicense {
    tier: LicenseTier;
    hardwareMultiplier: number;
    profile: HardwareProfile;
    availableModules: NodeModule[];
    activatedModules: ActivatedModule[];
    totalMonthlyCost: number;
    totalMonthlyEarnings: number;
    netMonthlyProfit: number;
    roi: number;
}

export class NodeLicenseManager {

    calculateLicense(profile?: HardwareProfile): NodeLicense {
        // Auto-detect if no profile provided
        if (!profile) {
            const detector = new HardwareDetector();
            profile = detector.detect();
        }

        const mult = calculateHardwareMultiplier(profile);
        const tier = getTierForMultiplier(mult);

        // Find available modules (hardware meets minimum requirements)
        const available = NODE_MODULES.filter(m => {
            if (m.needsGpu && !profile!.has_gpu) return false;
            if (m.minCpu > profile!.cpu_cores) return false;
            if (m.minRamGb > profile!.ram_gb * 0.7) return false; // 70% available
            if (m.minDiskGb > profile!.disk_gb * 0.8) return false;
            return true;
        });

        // Activate modules up to tier limit
        const toActivate = available.slice(0, tier.maxModules);

        const activated: ActivatedModule[] = toActivate.map(mod => {
            const cost = Math.round(mod.basePriceGSTD * mult);
            const baseEarnings = cost * mod.earnMultiplier;
            const bonusEarnings = baseEarnings * tier.stakingBonus / 100;
            const totalEarnings = Math.round(baseEarnings + bonusEarnings);
            
            return {
                module: mod,
                monthlyCostGSTD: cost,
                estimatedEarningsGSTD: totalEarnings,
                roi: totalEarnings / cost,
            };
        });

        const totalCost = activated.reduce((s, a) => s + a.monthlyCostGSTD, 0);
        const totalEarnings = activated.reduce((s, a) => s + a.estimatedEarningsGSTD, 0);

        return {
            tier,
            hardwareMultiplier: mult,
            profile,
            availableModules: available,
            activatedModules: activated,
            totalMonthlyCost: totalCost,
            totalMonthlyEarnings: totalEarnings,
            netMonthlyProfit: totalEarnings - totalCost,
            roi: totalCost > 0 ? totalEarnings / totalCost : 0,
        };
    }

    printLicense(license: NodeLicense): void {
        const p = license.profile;
        const t = license.tier;

        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log(`║  ${t.icon} GSTD Node License: ${t.name.toUpperCase().padEnd(12)}              ║`);
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  Hardware: ${p.cpu_cores} CPU | ${p.ram_gb}GB RAM | ${p.disk_gb}GB Disk ${p.has_gpu ? '| GPU ✓' : ''}`);
        console.log(`║  Multiplier: ×${license.hardwareMultiplier} | Max Modules: ${t.maxModules}`);
        console.log(`║  Staking Bonus: +${t.stakingBonus}%`);
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  Active Modules:');

        for (const a of license.activatedModules) {
            const m = a.module;
            const roiStr = a.roi.toFixed(1) + 'x';
            console.log(`║    ${m.icon} ${m.name.padEnd(18)} ${String(a.monthlyCostGSTD).padStart(5)} GSTD/mo → earn ${String(a.estimatedEarningsGSTD).padStart(6)} GSTD (${roiStr})`);
        }

        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  💸 Total Cost:     ${String(license.totalMonthlyCost).padStart(6)} GSTD/month`);
        console.log(`║  💰 Total Earnings: ${String(license.totalMonthlyEarnings).padStart(6)} GSTD/month`);
        console.log(`║  📈 Net Profit:     ${String(license.netMonthlyProfit).padStart(6)} GSTD/month (ROI: ${license.roi.toFixed(1)}x)`);
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');
    }

    // Returns data for the API / Dashboard
    toJSON(license: NodeLicense) {
        return {
            tier: license.tier.name,
            tierIcon: license.tier.icon,
            hardwareMultiplier: license.hardwareMultiplier,
            hardware: {
                cpu: license.profile.cpu_cores,
                ram_gb: license.profile.ram_gb,
                disk_gb: license.profile.disk_gb,
                gpu: license.profile.has_gpu,
                gpu_vram_gb: license.profile.gpu_vram_gb,
            },
            modules: license.activatedModules.map(a => ({
                id: a.module.id,
                name: a.module.name,
                icon: a.module.icon,
                cost_gstd: a.monthlyCostGSTD,
                earnings_gstd: a.estimatedEarningsGSTD,
                roi: parseFloat(a.roi.toFixed(2)),
                share_percent: a.module.revenueSharePercent,
            })),
            totals: {
                monthly_cost: license.totalMonthlyCost,
                monthly_earnings: license.totalMonthlyEarnings,
                monthly_profit: license.netMonthlyProfit,
                roi: parseFloat(license.roi.toFixed(2)),
                staking_bonus_percent: license.tier.stakingBonus,
            },
        };
    }
}
