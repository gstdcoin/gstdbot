/**
 * GSTD NaaS — Hardware Profiler & Role Assigner
 *
 * Automatically detects server capabilities (CPU/RAM/Disk/GPU)
 * and assigns the optimal set of blockchain node roles.
 *
 * Hardware tiers:
 *   Micro   (RPi/VPS): BTC, LTC, XLM light nodes
 *   Basic   (4-8GB):   +ETH light, TON, DOGE
 *   Standard(16GB):    +MATIC, AVAX, ATOM, SOL light
 *   Pro     (64GB):    +BNB, DOT, Near, Cardano
 *   Archive (128GB+):  ETH Archive, SOL full
 */

import { execSync } from 'child_process';
import { statSync, readdirSync } from 'fs';
import { cpus, totalmem, freemem } from 'os';

// ─── Chain Definitions ──────────────────────────────────────────
export interface ChainRequirements {
    ram_gb: number;
    cpu_cores: number;
    disk_gb: number;
    mode: 'light' | 'full' | 'archive' | 'rpc';
    dockerImage: string;
    rpcPort: number;
    envVars?: Record<string, string>;
    chain: string;
    priority: number; // lower = higher priority
    nativeToken: string;
    rewardPerQuery: number; // GSTD per 1000 requests
}

export const CHAIN_CATALOG: ChainRequirements[] = [
    // Light nodes (minimal resources)
    {
        chain: 'BTC', mode: 'light', ram_gb: 0.5, cpu_cores: 1, disk_gb: 15,
        dockerImage: 'btcpayserver/bitcoin:latest', rpcPort: 8332, priority: 1,
        nativeToken: 'BTC', rewardPerQuery: 0.005,
        envVars: { BITCOIN_NETWORK: 'mainnet', BITCOIN_DBCACHE: '200' },
    },
    {
        chain: 'LTC', mode: 'light', ram_gb: 0.5, cpu_cores: 1, disk_gb: 10,
        dockerImage: 'uphold/litecoin:latest', rpcPort: 9332, priority: 2,
        nativeToken: 'LTC', rewardPerQuery: 0.001,
    },
    {
        chain: 'TON', mode: 'full', ram_gb: 4, cpu_cores: 2, disk_gb: 100,
        dockerImage: 'ton-org/ton:latest', rpcPort: 8080, priority: 3,
        nativeToken: 'TON', rewardPerQuery: 0.002,
        envVars: { TON_GLOBAL_CONFIG: 'mainnet' },
    },
    {
        chain: 'XLM', mode: 'full', ram_gb: 1, cpu_cores: 1, disk_gb: 30,
        dockerImage: 'stellar/stellar-core:latest', rpcPort: 11626, priority: 4,
        nativeToken: 'XLM', rewardPerQuery: 0.001,
    },
    {
        chain: 'DOGE', mode: 'light', ram_gb: 1, cpu_cores: 1, disk_gb: 50,
        dockerImage: 'coinmetrics/dogecoin:latest', rpcPort: 22555, priority: 5,
        nativeToken: 'DOGE', rewardPerQuery: 0.001,
    },
    // Mid-tier (8GB+)
    {
        chain: 'ETH', mode: 'light', ram_gb: 4, cpu_cores: 2, disk_gb: 50,
        dockerImage: 'ethereum/client-go:stable', rpcPort: 8545, priority: 6,
        nativeToken: 'ETH', rewardPerQuery: 0.01,
        envVars: { GETH_SYNCMODE: 'light', GETH_CACHE: '1024' },
    },
    {
        chain: 'MATIC', mode: 'full', ram_gb: 4, cpu_cores: 2, disk_gb: 80,
        dockerImage: 'maticnetwork/bor:latest', rpcPort: 8545, priority: 7,
        nativeToken: 'MATIC', rewardPerQuery: 0.003,
    },
    {
        chain: 'AVAX', mode: 'full', ram_gb: 8, cpu_cores: 4, disk_gb: 100,
        dockerImage: 'avaplatform/avalanchego:latest', rpcPort: 9650, priority: 8,
        nativeToken: 'AVAX', rewardPerQuery: 0.005,
    },
    {
        chain: 'ATOM', mode: 'full', ram_gb: 4, cpu_cores: 2, disk_gb: 50,
        dockerImage: 'informalsystems/gaia:latest', rpcPort: 1317, priority: 9,
        nativeToken: 'ATOM', rewardPerQuery: 0.003,
    },
    {
        chain: 'ARB', mode: 'full', ram_gb: 4, cpu_cores: 2, disk_gb: 100,
        dockerImage: 'offchainlabs/nitro-node:latest', rpcPort: 8547, priority: 10,
        nativeToken: 'ETH', rewardPerQuery: 0.005,
    },
    {
        chain: 'OP', mode: 'full', ram_gb: 4, cpu_cores: 2, disk_gb: 100,
        dockerImage: 'ethereumoptimism/op-node:latest', rpcPort: 8545, priority: 11,
        nativeToken: 'ETH', rewardPerQuery: 0.005,
    },
    // Pro tier (32GB+)
    {
        chain: 'BNB', mode: 'full', ram_gb: 16, cpu_cores: 8, disk_gb: 500,
        dockerImage: 'bnbchain/bsc:latest', rpcPort: 8545, priority: 12,
        nativeToken: 'BNB', rewardPerQuery: 0.008,
    },
    {
        chain: 'SOL', mode: 'rpc', ram_gb: 32, cpu_cores: 16, disk_gb: 500,
        dockerImage: 'solanalabs/solana:latest', rpcPort: 8899, priority: 13,
        nativeToken: 'SOL', rewardPerQuery: 0.02,
    },
    {
        chain: 'DOT', mode: 'full', ram_gb: 8, cpu_cores: 4, disk_gb: 100,
        dockerImage: 'parity/polkadot:latest', rpcPort: 9944, priority: 14,
        nativeToken: 'DOT', rewardPerQuery: 0.005,
    },
    {
        chain: 'NEAR', mode: 'rpc', ram_gb: 8, cpu_cores: 4, disk_gb: 200,
        dockerImage: 'nearprotocol/nearcore:latest', rpcPort: 3030, priority: 15,
        nativeToken: 'NEAR', rewardPerQuery: 0.005,
    },
    {
        chain: 'ADA', mode: 'full', ram_gb: 16, cpu_cores: 4, disk_gb: 100,
        dockerImage: 'inputoutput/cardano-node:latest', rpcPort: 1337, priority: 16,
        nativeToken: 'ADA', rewardPerQuery: 0.004,
    },
    // Archive tier (128GB+)
    {
        chain: 'ETH', mode: 'archive', ram_gb: 32, cpu_cores: 8, disk_gb: 2000,
        dockerImage: 'ethereum/client-go:stable', rpcPort: 8546, priority: 20,
        nativeToken: 'ETH', rewardPerQuery: 0.1,
        envVars: { GETH_SYNCMODE: 'full', GETH_GCMODE: 'archive' },
    },
];

// ─── Hardware Profile ────────────────────────────────────────────
export interface HardwareProfile {
    cpu_cores: number;
    ram_gb: number;
    disk_gb: number;
    has_gpu: boolean;
    gpu_vram_gb: number;
    network_mbps: number;
    tier: 'micro' | 'basic' | 'standard' | 'pro' | 'archive';
}

// ─── Hardware Detector ───────────────────────────────────────────
export class HardwareDetector {
    detect(): HardwareProfile {
        const cpu_cores = cpus().length;
        const ram_gb   = Math.floor(totalmem() / (1024 ** 3));
        const disk_gb  = this.getFreeDisk();
        const has_gpu  = this.detectGPU();
        const gpu_vram = has_gpu ? this.getGPUVRAM() : 0;

        const tier = this.assignTier(cpu_cores, ram_gb, disk_gb);

        return { cpu_cores, ram_gb, disk_gb, has_gpu, gpu_vram_gb: gpu_vram, network_mbps: 100, tier };
    }

    private getFreeDisk(): number {
        try {
            const out = execSync("df -BG / | tail -1 | awk '{print $4}'", { timeout: 3000 }).toString().trim();
            return parseInt(out.replace('G', '')) || 20;
        } catch { return 20; }
    }

    private detectGPU(): boolean {
        try {
            execSync('nvidia-smi -L', { timeout: 3000, stdio: 'pipe' });
            return true;
        } catch { return false; }
    }

    private getGPUVRAM(): number {
        try {
            const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 3000 }).toString().trim();
            return Math.floor(parseInt(out) / 1024);
        } catch { return 0; }
    }

    private assignTier(cpu: number, ram: number, disk: number): HardwareProfile['tier'] {
        if (ram >= 128 && disk >= 5000) return 'archive';
        if (ram >= 32  && disk >= 500)  return 'pro';
        if (ram >= 16  && disk >= 200)  return 'standard';
        if (ram >= 8   && disk >= 100)  return 'basic';
        return 'micro';
    }
}

// ─── Role Assigner ───────────────────────────────────────────────
export interface AssignedRole {
    chain: string;
    mode: string;
    rpcPort: number;
    dockerImage: string;
    envVars?: Record<string, string>;
    estimatedReward: number; // GSTD/month
    nativeToken: string;
}

export class RoleAssigner {
    assign(profile: HardwareProfile): AssignedRole[] {
        let available_ram  = profile.ram_gb  * 0.70; // 70% available for chains
        let available_disk = profile.disk_gb * 0.80; // 80% available for chains
        const assigned: AssignedRole[] = [];

        // Sort by priority (lower number = add first)
        const sorted = [...CHAIN_CATALOG].sort((a, b) => a.priority - b.priority);

        for (const cfg of sorted) {
            if (cfg.cpu_cores > profile.cpu_cores) continue;
            if (cfg.ram_gb > available_ram)         continue;
            if (cfg.disk_gb > available_disk)       continue;

            assigned.push({
                chain:           cfg.chain,
                mode:            cfg.mode,
                rpcPort:         cfg.rpcPort,
                dockerImage:     cfg.dockerImage,
                envVars:         cfg.envVars,
                nativeToken:     cfg.nativeToken,
                estimatedReward: cfg.rewardPerQuery * 1000 * 30, // ~1k req/day × 30 days
            });

            available_ram  -= cfg.ram_gb;
            available_disk -= cfg.disk_gb;
        }

        return assigned;
    }

    summarize(roles: AssignedRole[], profile: HardwareProfile): void {
        const totalMonthly = roles.reduce((s, r) => s + r.estimatedReward, 0);

        console.log('\n╔══════════════════════════════════════════════╗');
        console.log(`║  🌐 GSTD NaaS — Hardware Profile: ${profile.tier.toUpperCase().padEnd(8)}║`);
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  CPU: ${profile.cpu_cores} cores  RAM: ${profile.ram_gb}GB  Disk: ${profile.disk_gb}GB`.padEnd(47) + '║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  Assigned ${roles.length} blockchain roles:`);
        for (const r of roles) {
            console.log(`║    ✅ ${r.chain} (${r.mode}) → port :${r.rpcPort}  +${r.estimatedReward.toFixed(0)} GSTD/mo`);
        }
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  💰 Estimated: ~${totalMonthly.toFixed(0)} GSTD/month`.padEnd(47) + '║');
        console.log('╚══════════════════════════════════════════════╝\n');
    }
}
