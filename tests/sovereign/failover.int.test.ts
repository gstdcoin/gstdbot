import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyProofBundle } from '../../src/sovereign/board.js';
import { cleanup, spawnNode, startSource, taskStatus, waitFor, type NodeHandle, type Source } from './harness.js';

describe('publisher failover across processes', () => {
    let source: Source;
    const nodes: NodeHandle[] = [];

    beforeAll(async () => { source = await startSource(); source.setVersions('left-pad', ['1.0.0', '1.1.0']); }, 30_000);
    afterAll(async () => { await cleanup(nodes); await source.close(); }, 60_000);

    it('a named backup finishes the task after the publisher dies', async () => {
        const P = await spawnNode({ name: 'pub', source, roles: ['relay'] });
        const B = await spawnNode({ name: 'backup', source, roles: ['relay'], peers: [P.url] });
        const W = await spawnNode({ name: 'worker', source, roles: ['data'], peers: [P.url, B.url] });
        const V = await spawnNode({ name: 'verifier', source, roles: ['verify'], peers: [P.url, B.url] });
        nodes.push(P, B, W, V);
        await waitFor('mesh', async () => (await Promise.all([B, W, V].map(n => n.get('/sov/health')))).every(h => h.objects >= 1));

        const { taskId } = await P.admin('/sov/admin/publish', {
            package: 'left-pad', funding: 'commercial', budgetNano: '1000000', minVerifiers: 1, leaseMs: 2500, backups: [B.nodeId],
        });
        await waitFor('backup has the manifest', async () => (await taskStatus(B, taskId)) !== undefined, 15_000);
        await P.kill();

        await waitFor('task accepted without the publisher', async () => (await taskStatus(V, taskId)) === 'accepted', 60_000);
        const q = await V.get('/sov/query?entity=npm:left-pad');
        expect(verifyProofBundle(q.current.proof).ok).toBe(true);
        const signers = new Set((q.current.proof.envelopes as Array<{ type: string; signer: string }>).filter(e => e.type === 'task.lease').map(e => e.signer));
        expect(signers.has(B.nodeId)).toBe(true);
    }, 120_000);
});
