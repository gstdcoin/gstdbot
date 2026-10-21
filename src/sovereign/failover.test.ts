import { describe, expect, it } from 'vitest';
import { signEnvelope } from './crypto.js';
import { failoverMs } from './board.js';
import { computeAccruals } from './rewards.js';
import { identity, load, manifestPayload, versionOf } from './testkit.js';

function setup() {
    const publisher = identity(); const backup = identity(); const outsider = identity(); const worker = identity(); const verifier = identity();
    const t0 = Date.now() - 60_000;
    const payload = manifestPayload({ backups: [backup.nodeId], leaseMs: 2000, deadline: Date.now() + 120_000 });
    const publish = signEnvelope(publisher, 'task.publish', payload, t0);
    const window = failoverMs(publish.payload as never);
    return { publisher, backup, outsider, worker, verifier, t0, publish, taskId: publish.id, window };
}

describe('publisher failover', () => {
    it('ignores a backup lease stamped before the failover window opens', () => {
        const s = setup();
        const early = signEnvelope(s.backup, 'task.lease', { taskId: s.taskId, role: 'data', worker: s.worker.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, s.t0 + s.window - 1);
        expect(load([s.publish, early]).leases(s.taskId)).toHaveLength(0);
    });

    it('accepts a backup lease after the window and lets the task complete without the publisher', () => {
        const s = setup();
        const at = s.t0 + s.window + 10;
        const dataLease = signEnvelope(s.backup, 'task.lease', { taskId: s.taskId, role: 'data', worker: s.worker.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, at);
        const content = { name: 'left-pad', distTags: { latest: '1.0.0' }, versions: [{ version: '1.0.0', publishedAt: null }] };
        const result = signEnvelope(s.worker, 'task.result', { taskId: s.taskId, leaseId: dataLease.id, version: versionOf(content) });
        const verifyLease = signEnvelope(s.backup, 'task.lease', { taskId: s.taskId, role: 'verify', worker: s.verifier.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, at + 1);
        const attest = signEnvelope(s.verifier, 'task.attest', { taskId: s.taskId, resultId: result.id, verdict: 'match', observedHash: result.payload.version.contentHash, reason: 'test' });
        const board = load([s.publish, dataLease, result, verifyLease, attest]);
        expect(board.evaluate(s.taskId).status).toBe('accepted');
        expect(board.lastCoordinator(s.taskId)?.signer).toBe(s.backup.nodeId);
    });

    it('never accepts leases from a node the publisher did not name', () => {
        const s = setup();
        const lease = signEnvelope(s.outsider, 'task.lease', { taskId: s.taskId, role: 'data', worker: s.outsider.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, s.t0 + s.window + 10);
        expect(load([s.publish, lease]).leases(s.taskId)).toHaveLength(0);
    });

    it('a manifest without backups behaves exactly as before', () => {
        const s = setup();
        const plain = signEnvelope(s.publisher, 'task.publish', manifestPayload({ leaseMs: 2000 }), s.t0);
        const lease = signEnvelope(s.backup, 'task.lease', { taskId: plain.id, role: 'data', worker: s.worker.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, s.t0 + 60_000);
        expect(load([plain, lease]).leases(plain.id)).toHaveLength(0);
    });

    it('rejects manifests naming more than three backups', () => {
        const s = setup();
        const many = signEnvelope(s.publisher, 'task.publish', manifestPayload({ backups: [1, 2, 3, 4].map(() => identity().nodeId) }));
        expect(load([many]).taskIds()).toHaveLength(0);
    });

    it('does not pay a backup coordinator for executing its own task', () => {
        const s = setup();
        const at = s.t0 + s.window + 10;
        const lease = signEnvelope(s.publisher, 'task.lease', { taskId: s.taskId, role: 'data', worker: s.backup.nodeId, epoch: 1, expiresAt: Date.now() + 5000 });
        const content = { name: 'left-pad', distTags: {}, versions: [] };
        const result = signEnvelope(s.backup, 'task.result', { taskId: s.taskId, leaseId: lease.id, version: versionOf(content) });
        const vLease = signEnvelope(s.publisher, 'task.lease', { taskId: s.taskId, role: 'verify', worker: s.verifier.nodeId, epoch: 1, expiresAt: Date.now() + 5000 }, at);
        const attest = signEnvelope(s.verifier, 'task.attest', { taskId: s.taskId, resultId: result.id, verdict: 'match', observedHash: result.payload.version.contentHash, reason: 'test' });
        const board = load([s.publish, lease, result, vLease, attest]);
        expect(board.evaluate(s.taskId).status).toBe('accepted');
        expect(computeAccruals(s.taskId, board).some(a => a.node === s.backup.nodeId)).toBe(false);
    });
});
