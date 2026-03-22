/**
 * GSTD NaaS — Temporal Data Sharding (Archival Nodes)
 *
 * Implements Section 4 of the Whitepaper:
 * Divides heavy archival nodes (e.g., Ethereum 12TB) into chunks.
 * Instead of 1 node storing 12TB, 100 nodes store 120GB each.
 *
 * Sharding logic:
 *   - Total shards: 100 (e.g., 0 to 99)
 *   - Provider's shard is determined by hash(provider_address) % TOTAL_SHARDS
 *   - Node only syncs blocks where (block_number % TOTAL_SHARDS) == shard_id
 */

import { createHash } from 'crypto';
import { logActivity } from '../gateway/server.js';

export interface ShardConfig {
    chain: string;
    totalShards: number;
    blocksPerShard: number;  // Chunk size (e.g., 100k blocks = 1 shard chunk)
    replicationFactor: number; // k=3 min
}

const SHARD_CONFIGS: Record<string, ShardConfig> = {
    // Ethereum: ~20M blocks. 100 shards = 200k blocks per shard.
    eth: { chain: 'eth', totalShards: 100, blocksPerShard: 200_000, replicationFactor: 3 },
    // Solana: 300M slots. 1000 shards = 300k slots per shard.
    sol: { chain: 'sol', totalShards: 1000, blocksPerShard: 300_000, replicationFactor: 5 },
    // Polygon: ~50M blocks
    matic: { chain: 'matic', totalShards: 250, blocksPerShard: 200_000, replicationFactor: 3 },
};

// ─── Data Sharder ────────────────────────────────────────────────
export class TemporalDataSharder {
    
    constructor(private providerWalletAddr: string) {}

    // 1. Assigns a shard ID to this specific provider based on their wallet address
    assignShardId(chain: string): number {
        const config = SHARD_CONFIGS[chain];
        if (!config) return 0; // Not sharded (Light node)

        // Deterministic shard assignment: sha256(addr) % total_shards
        const hashHex = createHash('sha256').update(this.providerWalletAddr).digest('hex');
        const hashInt = BigInt('0x' + hashHex);
        const shardId = Number(hashInt % BigInt(config.totalShards));

        return shardId;
    }

    // 2. Returns the block ranges this specific node is responsible for storing
    getAssignedBlockRanges(chain: string, latestBlockHead: number): { start: number; end: number }[] {
        const config = SHARD_CONFIGS[chain];
        if (!config) return [{ start: 0, end: latestBlockHead }]; // Light node stores everything necessary

        const shardId = this.assignShardId(chain);
        const ranges: { start: number; end: number }[] = [];

        // E.g. eth chunk 0: 0-199999. If our shard is 5, we store chunk 5, chunk 105, chunk 205...
        for (let chunk = shardId; chunk * config.blocksPerShard <= latestBlockHead; chunk += config.totalShards) {
            const start = chunk * config.blocksPerShard;
            let end = start + config.blocksPerShard - 1;
            if (end > latestBlockHead) {
                end = latestBlockHead;
            }
            ranges.push({ start, end });
        }

        // Always store the latest 10,000 blocks regardless of shard (for standard RPC routing)
        const recentStart = Math.max(0, latestBlockHead - 10000);
        ranges.push({ start: recentStart, end: latestBlockHead });

        return ranges;
    }

    // 3. Generates the necessary flags to pass to the Docker container
    // so the blockchain client only syncs the assigned ranges.
    getDockerSyncFlags(chain: string): Record<string, string> {
        const shardId = this.assignShardId(chain);
        const config = SHARD_CONFIGS[chain];

        if (chain === 'eth') {
            // Erigon supports temporal sharding via --prune and specific state settings limiters natively or via snapshot configs.
            return {
                'ERIGON_SHARD': shardId.toString(),
                'ERIGON_TOTAL_SHARDS': config?.totalShards.toString() || '100',
                'GETH_SYNCMODE': 'snap', // or modified archive config
            };
        } else if (chain === 'sol') {
            return {
                'SOLANA_LIMIT_LEDGER_SIZE': '200000000',
                'SOLANA_SHARD_ID': shardId.toString(),
            };
        }

        return {};
    }

    // 4. Prints assigned shards
    printShardInfo(chain: string, head: number) {
        if (!SHARD_CONFIGS[chain]) return;
        const shardId = this.assignShardId(chain);
        const ranges = this.getAssignedBlockRanges(chain, head);
        
        logActivity(`🗃️ Archival Sharding [${chain.toUpperCase()}]: Assigned Shard #${shardId}`, 'info');
        logActivity(`   Active Chunk Ranges: ${ranges.length} ranges (approx ${(ranges.length * SHARD_CONFIGS[chain].blocksPerShard) / 1000}K blocks)`, 'info');
    }
}
