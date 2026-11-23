import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyProofBundle } from '../../src/sovereign/board.js';
import { identity, manifestPayload, versionOf } from '../../src/sovereign/testkit.js';
import { signEnvelope } from '../../src/sovereign/crypto.js';
import { cleanup, spawnNode, startSource, taskStatus, waitFor, type NodeHandle, type Source } from './harness.js';

const SRC = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'src', 'sovereign');
const PUBLISH = (budgetNano = '1000000', extra: Record<string, unknown> = {}) => ({ package: 'left-pad', funding: 'commercial', budgetNano, minVerifiers: 1, leaseMs: 6000, ...extra });

describe('A-D, G, H: four independent processes, no central service', () => {
    let source: Source;
    const nodes: NodeHandle[] = [];
    let P: NodeHandle, W1: NodeHandle, W2: NodeHandle, V: NodeHandle;
    let taskId = '';

    beforeAll(async () => {
        source = await startSource();
        source.setVersions('left-pad', ['1.0.0', '1.1.0']);
        P = await spawnNode({ name: 'pub', source, roles: ['relay'] });
        // Workers and the verifier only know the publisher; they find each other through peer exchange.
        W1 = await spawnNode({ name: 'w1', source, roles: ['data'], peers: [P.url], price: '1' });
        W2 = await spawnNode({ name: 'w2', source, roles: ['data'], peers: [P.url], price: '2' });
        V = await spawnNode({ name: 'ver', source, roles: ['verify'], peers: [P.url] });
        nodes.push(P, W1, W2, V);
    }, 90_000);
    afterAll(async () => { await cleanup(nodes); await source.close(); }, 60_000);

    it('A/B/C: publishes, executes, independently verifies and settles the ledger with all central endpoints dead', async () => {
        await waitFor('mesh discovery', async () => (await Promise.all([W1, W2, V].map(n => n.get('/sov/health')))).every(h => h.objects >= 1) && (await V.get('/sov/sync')).peers.length >= 3);
        taskId = (await P.admin('/sov/admin/publish', PUBLISH())).taskId;
        expect(taskId).toMatch(/^[0-9a-f]{64}$/);
        for (const n of nodes) await waitFor(`${n.name} sees accepted task`, async () => (await taskStatus(n, taskId)) === 'accepted', 40_000);

        const q = await V.get('/sov/query?entity=npm:left-pad');
        expect(q.status).toBe(200);
        expect(q.current.content.distTags.latest).toBe('1.1.0');
        // The client verifies the proof offline, without trusting the serving node.
        expect(verifyProofBundle(q.current.proof).ok).toBe(true);
        expect(q.current.worker).toBe(W1.nodeId); // cheapest data node wins selection
        expect(q.current.verifiers).toEqual([V.nodeId]);

        const ledgerIds = async () => (await Promise.all(nodes.map(n => n.admin('/sov/admin/ledger'))))
            .map(l => (l.accruals as Array<{ accrualId: string }>).map(a => a.accrualId).sort().join(','));
        await waitFor('ledgers converge', async () => { const ids = await ledgerIds(); return ids[0].split(',').length === 2 && new Set(ids).size === 1; }, 30_000);
        const ledgers = await Promise.all(nodes.map(n => n.admin('/sov/admin/ledger')));
        expect(ledgers[0].accruals).toHaveLength(2);
        expect(ledgers[0].simulation.realTransfersExecuted).toBe(0);
    }, 120_000);

    it('keeps a hash-chained history when the source changes', async () => {
        source.setVersions('left-pad', ['1.0.0', '1.1.0', '1.2.0']);
        const second = (await P.admin('/sov/admin/publish', PUBLISH())).taskId;
        await waitFor('second task accepted on verifier', async () => (await taskStatus(V, second)) === 'accepted', 40_000);
        const q = await V.get('/sov/query?entity=npm:left-pad');
        expect(q.history).toHaveLength(2);
        expect(q.history[1].prevChainHash).toBe(q.history[0].chainHash);
        expect(q.current.content.versions.map((v: { version: string }) => v.version)).toContain('1.2.0');
    }, 90_000);

    it('D: a node with one dead bootstrap address still joins and catches up', async () => {
        const late = await spawnNode({ name: 'late', source, roles: ['verify'], peers: ['http://127.0.0.1:9', P.url] });
        nodes.push(late);
        await waitFor('late node catches up', async () => (await late.get('/sov/entities')).entities.includes('npm:left-pad'), 30_000);
    }, 60_000);

    it('G: delivering the same signed object twice is idempotent', async () => {
        const env = signEnvelope(identity(), 'node.announce', { roles: ['relay'], adapters: [], priceNano: '0', protocol: 1 });
        expect((await W2.post('/sov/msg', { envelope: env })).added).toBe(true);
        expect((await W2.post('/sov/msg', { envelope: env })).added).toBe(false);
    });

    it('H: a second node claiming a leased task cannot get paid or change the outcome', async () => {
        const before = (await P.admin('/sov/admin/ledger')).accruals.length;
        const intruder = identity();
        const stolen = signEnvelope(intruder, 'task.result', { taskId, leaseId: '0'.repeat(64), version: versionOf({ forged: true }) });
        expect((await P.post('/sov/msg', { envelope: stolen })).added).toBe(true); // structurally valid, stored...
        await new Promise(r => setTimeout(r, 1500));
        expect(await taskStatus(P, taskId)).toBe('accepted');
        expect((await P.admin('/sov/admin/ledger')).accruals).toHaveLength(before); // ...but never counted
        const q = await P.get('/sov/query?entity=npm:left-pad');
        expect(q.current.content.forged).toBeUndefined();
    });

    it('I: a result whose content does not match its hash is refused at the door', async () => {
        const worker = identity();
        const bad = signEnvelope(worker, 'task.result', { taskId, leaseId: '1'.repeat(64), version: { ...versionOf({ a: 1 }), content: { a: 2 } } });
        const r = await P.post('/sov/msg', { envelope: bad });
        expect(r.added).toBe(false);
    });

    it('rejects malformed and unauthenticated input', async () => {
        expect((await P.admin('/sov/admin/ledger')).accruals).toBeDefined();
        const noAuth = await fetch(`${P.url}/sov/admin/ledger`);
        expect(noAuth.status).toBe(401);
        const garbage = await P.post('/sov/msg', { envelope: { v: 1, type: 'task.result' } });
        expect(garbage.added).toBe(false);
        const unknown = await P.get('/sov/query?entity=npm:does-not-exist');
        expect(unknown.status).toBe(404);
    });

    it('the sovereign module contains no hard dependency on Cloudflare, the platform API or Telegram', () => {
        const forbidden = /gstdtoken\.(?:com|xyz)|cloudflare|workers\.dev|api\.telegram|app\.gstd/i;
        for (const f of readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
            expect(readFileSync(join(SRC, f), 'utf-8'), f).not.toMatch(forbidden);
        }
    });

    it('survives a worker disappearing: process restart keeps its queue and objects', async () => {
        const before = (await W1.get('/sov/health')).objects;
        await W1.kill();
        const back = await spawnNode({ name: 'w1-again', source, roles: ['data'], peers: [P.url], dataDir: W1.dataDir, price: '1' });
        nodes.push(back);
        expect(back.nodeId).toBe(W1.nodeId);
        expect((await back.get('/sov/health')).objects).toBeGreaterThanOrEqual(before);
        // Replaying persisted state must not create new accruals (L).
        const ledger = await back.admin('/sov/admin/ledger');
        expect(new Set(ledger.accruals.map((a: { accrualId: string }) => a.accrualId)).size).toBe(ledger.accruals.length);
    }, 60_000);
});

describe('E, F, K: executor and publisher crashes', () => {
    let source: Source;
    const nodes: NodeHandle[] = [];
    afterAll(async () => { await cleanup(nodes); await source.close(); }, 60_000);

    it('reassigns after the executor dies, ignores its late return, and recovers the publisher queue after a restart', async () => {
        source = await startSource();
        source.setVersions('left-pad', ['1.0.0']);
        let P = await spawnNode({ name: 'pub', source, roles: ['relay'] });
        const slow = await spawnNode({ name: 'slow', source, roles: ['data'], peers: [P.url], price: '0', env: { GSTD_SOV_FETCH_DELAY_MS: '15000' } });
        const fast = await spawnNode({ name: 'fast', source, roles: ['data'], peers: [P.url], price: '5' });
        const V = await spawnNode({ name: 'ver', source, roles: ['verify'], peers: [P.url] });
        nodes.push(P, slow, fast, V);
        await waitFor('announces seen', async () => (await P.get('/sov/health')).objects >= 4);

        const taskId = (await P.admin('/sov/admin/publish', PUBLISH('1000000', { leaseMs: 2500 }))).taskId;
        await waitFor('slow executor leased', async () => (await slow.get('/sov/tasks')).tasks.some((t: { taskId: string; status: string }) => t.taskId === taskId && t.status === 'leased'));

        // E: executor goes offline after receiving the lease. K: the publisher restarts as well.
        await slow.kill();
        const pubDir = P.dataDir;
        await P.kill();
        P = await spawnNode({ name: 'pub2', source, roles: ['relay'], dataDir: pubDir, peers: [fast.url, V.url] });
        nodes.push(P);

        await waitFor('reassigned task accepted', async () => (await taskStatus(P, taskId)) === 'accepted', 60_000);
        const q = await P.get('/sov/query?entity=npm:left-pad');
        expect(q.current.worker).toBe(fast.nodeId);

        // F: the original executor returns with its old state; the task stays settled exactly once.
        const back = await spawnNode({ name: 'slow2', source, roles: ['data'], peers: [P.url], dataDir: slow.dataDir, price: '0' });
        nodes.push(back);
        await waitFor('returned node converges', async () => (await taskStatus(back, taskId)) === 'accepted', 30_000);
        await new Promise(r => setTimeout(r, 1500));
        const ledgers = await Promise.all([P, back, V, fast].map(n => n.admin('/sov/admin/ledger')));
        for (const l of ledgers) expect(l.accruals.filter((a: { role: string }) => a.role === 'execute')).toHaveLength(1);
        expect(ledgers[0].accruals.find((a: { role: string }) => a.role === 'execute').node).toBe(fast.nodeId);
    }, 150_000);
});

describe('I: lying worker', () => {
    let source: Source;
    const nodes: NodeHandle[] = [];
    afterAll(async () => { await cleanup(nodes); await source.close(); }, 60_000);

    it('a worker that fabricates content is rejected by an independent verifier and earns nothing', async () => {
        source = await startSource();
        source.setVersions('left-pad', ['1.0.0']);
        const P = await spawnNode({ name: 'pub', source, roles: ['relay'] });
        const liar = await spawnNode({ name: 'liar', source, roles: ['data'], peers: [P.url], env: { GSTD_SOV_FAULT_INJECTION: '1', GSTD_SOV_TAMPER: '1' } });
        const V = await spawnNode({ name: 'ver', source, roles: ['verify'], peers: [P.url] });
        nodes.push(P, liar, V);
        await waitFor('announces seen', async () => (await P.get('/sov/health')).objects >= 3);
        const taskId = (await P.admin('/sov/admin/publish', PUBLISH())).taskId;
        await waitFor('task rejected', async () => (await taskStatus(P, taskId)) === 'rejected', 40_000);
        expect((await P.get('/sov/query?entity=npm:left-pad')).status).toBe(404);
        expect((await P.admin('/sov/admin/ledger')).accruals).toHaveLength(0);
    }, 90_000);
});

describe('J: network partition and recovery', () => {
    let source: Source;
    const nodes: NodeHandle[] = [];
    afterAll(async () => { await cleanup(nodes); await source.close(); }, 60_000);

    it('two isolated islands each complete work, then converge after being joined', async () => {
        source = await startSource();
        source.setVersions('left-pad', ['1.0.0']);
        source.setVersions('is-odd', ['2.0.0']);
        const mk = async (island: string, boot?: string) => {
            const p = await spawnNode({ name: `${island}-pub`, source, roles: ['relay'], peers: boot ? [boot] : [] });
            const w = await spawnNode({ name: `${island}-w`, source, roles: ['data'], peers: [p.url] });
            const v = await spawnNode({ name: `${island}-v`, source, roles: ['verify'], peers: [p.url] });
            nodes.push(p, w, v);
            return { p, w, v };
        };
        const a = await mk('a'); const b = await mk('b');
        await waitFor('islands formed', async () => (await a.p.get('/sov/health')).objects >= 3 && (await b.p.get('/sov/health')).objects >= 3);

        const ta = (await a.p.admin('/sov/admin/publish', PUBLISH())).taskId;
        const tb = (await b.p.admin('/sov/admin/publish', { ...PUBLISH(), package: 'is-odd' })).taskId;
        await waitFor('island a settles', async () => (await taskStatus(a.v, ta)) === 'accepted', 40_000);
        await waitFor('island b settles', async () => (await taskStatus(b.v, tb)) === 'accepted', 40_000);
        expect((await a.v.get('/sov/entities')).entities).toEqual(['npm:left-pad']);
        expect((await b.v.get('/sov/entities')).entities).toEqual(['npm:is-odd']);

        await a.p.admin('/sov/admin/peer', { url: b.p.url });
        for (const n of nodes) await waitFor(`${n.name} converged`, async () => (await n.get('/sov/entities')).entities.length === 2, 40_000);
        await waitFor('ledgers converge', async () => {
            const ls = await Promise.all(nodes.map(n => n.admin('/sov/admin/ledger')));
            return ls.every(l => l.accruals.length === 4);
        }, 30_000);
        const ledgers = await Promise.all(nodes.map(n => n.admin('/sov/admin/ledger')));
        expect(new Set(ledgers.map(l => l.accruals.length)).size).toBe(1);
        expect(ledgers[0].accruals).toHaveLength(4);
    }, 180_000);
});
