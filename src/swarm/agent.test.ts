import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwarmAgent } from './agent.js';
import type { AttestorIdentity } from '../p2p/identity.js';
import type { Attestation } from '../p2p/attestation.js';

vi.mock('../gateway/server.js', () => ({ logActivity: vi.fn() }));
vi.mock('../lib/platform-health.js', () => ({ platformHealth: { getStatus: vi.fn() } }));
vi.mock('../blockchain/bridge.js', () => ({ CrossChainBridge: class {} }));

vi.mock('../p2p/attestation.js', () => ({
    hashResult: vi.fn().mockReturnValue(0n),
    signAttestation: vi.fn().mockReturnValue({ pubkeyHex: 'a'.repeat(64), signatureHex: 'b'.repeat(128) }),
    taskIdToUint64: vi.fn().mockReturnValue(0n),
    buildAttestationsChain: vi.fn(),
    verifyAttestationLocally: vi.fn(),
}));

vi.mock('../p2p/quorum-coordinator.js', () => ({
    awaitQuorum: vi.fn().mockResolvedValue({ accepted: false, attestations: [], reason: 'no quorum' }),
}));

vi.mock('@ton/core', () => ({
    Address: { parse: vi.fn().mockReturnValue({}) },
    beginCell: vi.fn(),
}));

const mockConfig = {
    nodeId: 'test-node-id',
    version: '1.0.0',
    nodeName: 'test',
    swarm: { enabled: true, maxCPU: 80, maxRAM: 80, apiUrl: 'http://test' },
    models: { available: [], ollamaUrl: '' },
    port: 8080,
    apiPort: 3000,
    publicUrl: '',
} as any;

const mockWallet = {
    getAddress: () => 'EQtest123',
    recordVerifiedEarning: vi.fn(),
} as any;

const mockMemory = {
    getEntryCount: () => 0,
    store: vi.fn(),
    retrieve: vi.fn(),
} as any;

const mockIdentity: AttestorIdentity = {
    keyPair: { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) } as any,
    pubkeyHex: '00'.repeat(32),
};

const baseTask = {
    id: 'task-abc',
    type: 'inference',
    model: 'llama3',
    prompt: 'hello',
    payload: {},
    reward_gstd: 1,
    requester: 'peer1',
    priority: 1,
};

describe('SwarmAgent quorum attestation gaps', () => {

    describe('task.id normalization in participateInQuorumVerification', () => {
        it('sets task.id from task.task_id when id is absent', async () => {
            const agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            // Do NOT call setIdentity — function returns early after normalization
            const task: any = {
                task_id: 'peer-task-123',
                type: 'inference',
                model: 'llama3',
                prompt: 'hi',
                payload: {},
                reward_gstd: 0,
                requester: 'peer1',
                priority: 1,
            };
            await (agent as any).participateInQuorumVerification(task, [], 2);
            // Normalization ran before identity guard fired
            expect(task.id).toBe('peer-task-123');
        });
    });

    describe('setIdentity guard in attemptQuorumSettlement', () => {
        it('returns without calling hashResult when identity is not set', async () => {
            const agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            // Provide p2pNode with 2 peers so the function passes the p2pNode/peers guards
            // and actually reaches the identity guard at line 702
            (agent as any).p2pNode = {
                getPeers: () => [{ nodeId: 'peer1' }, { nodeId: 'peer2' }],
            };
            // Do NOT call setIdentity — identity guard must fire
            const { hashResult } = await import('../p2p/attestation.js');
            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });
            expect(hashResult).not.toHaveBeenCalled();
        });
    });

    describe('with identity + peerManager + mocked quorum', () => {
        let agent: SwarmAgent;
        const mockPm = { recordOutcome: vi.fn() } as any;

        const mockP2PNode = {
            getPeers: () => [{ nodeId: 'peer1' }, { nodeId: 'peer2' }],
            sendTask: vi.fn().mockResolvedValue(undefined),
        };

        beforeEach(async () => {
            vi.clearAllMocks();
            agent = new SwarmAgent(mockConfig, mockWallet, mockMemory);
            agent.setIdentity(mockIdentity);
            agent.setPeerManager(mockPm);
            (agent as any).p2pNode = mockP2PNode;
            vi.spyOn(agent as any, 'apiCall').mockResolvedValue({ ok: true });
        });

        it('calls recordOutcome for each co-executor after quorum accepted', async () => {
            const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
            const fakeAtts: Attestation[] = [
                { pubkeyHex: 'a'.repeat(64), signatureHex: 'b'.repeat(128) },
                { pubkeyHex: 'c'.repeat(64), signatureHex: 'd'.repeat(128) },
            ];
            vi.mocked(awaitQuorum).mockResolvedValueOnce({
                accepted: true,
                resultHash: 'deadbeef',
                attestations: fakeAtts,
                reason: '',
            });

            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });

            expect(mockPm.recordOutcome).toHaveBeenCalledTimes(2);
            expect(mockPm.recordOutcome).toHaveBeenCalledWith('peer1', true);
            expect(mockPm.recordOutcome).toHaveBeenCalledWith('peer2', true);
        });

        it('increments quorumProofsSubmitted and quorumAttestationsTotal on successful quorum', async () => {
            const { awaitQuorum } = await import('../p2p/quorum-coordinator.js');
            const fakeAtts3: Attestation[] = [
                { pubkeyHex: 'a'.repeat(64), signatureHex: 'b'.repeat(128) },
                { pubkeyHex: 'c'.repeat(64), signatureHex: 'd'.repeat(128) },
                { pubkeyHex: 'e'.repeat(64), signatureHex: 'f'.repeat(128) },
            ];
            vi.mocked(awaitQuorum).mockResolvedValueOnce({
                accepted: true,
                resultHash: 'deadbeef',
                attestations: fakeAtts3,
                reason: '',
            });

            await (agent as any).attemptQuorumSettlement(baseTask, 'task-abc', { output: 'test' });

            const stats = agent.getStats();
            expect(stats.quorumProofsSubmitted).toBe(1);
            expect(stats.quorumAttestationsTotal).toBe(3);
        });
    });

});
