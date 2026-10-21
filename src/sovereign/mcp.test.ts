import { describe, expect, it } from 'vitest';
import { handleRpc, type McpContext } from './mcp.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function ctx(routes: Record<string, (init?: RequestInit) => Response>, adminToken?: string): McpContext {
    return {
        nodeUrl: 'http://node.test', adminToken,
        fetchImpl: (async (url: string, init?: RequestInit) => {
            const path = new URL(url).pathname + new URL(url).search;
            const h = routes[path] ?? routes[new URL(url).pathname];
            return h ? h(init) : json({ error: 'nf' }, 404);
        }) as typeof fetch,
    };
}

const call = (c: McpContext, name: string, args?: unknown) =>
    handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c) as Promise<any>;

describe('MCP wrapper', () => {
    it('answers initialize, ping and tools/list; ignores notifications', async () => {
        const c = ctx({});
        const init: any = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, c);
        expect(init.result.capabilities.tools).toBeDefined();
        expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, c)).toBeNull();
        const list: any = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, c);
        expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('gstd_query_entity');
        const bad: any = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }, c);
        expect(bad.error.code).toBe(-32601);
    });

    it('reports node status through the node HTTP API', async () => {
        const c = ctx({ '/sov/health': () => json({ nodeId: 'abc', objects: 3 }), '/sov/sync': () => json({ peers: ['http://p1'] }) });
        const r = await call(c, 'gstd_network_status');
        expect(JSON.parse(r.result.content[0].text)).toMatchObject({ nodeId: 'abc', peers: ['http://p1'] });
    });

    it('flags a query without a valid proof as not verified offline', async () => {
        const c = ctx({ '/sov/query': () => json({ entity: 'npm:x', current: { proof: { entity: 'npm:x', taskId: 'a'.repeat(64), envelopes: [] } } }) });
        const r = await call(c, 'gstd_query_entity', { entity: 'npm:x' });
        expect(JSON.parse(r.result.content[0].text).proofVerifiedOffline).toBe(false);
    });

    it('validates arguments and refuses to publish without an admin token', async () => {
        const noToken = await call(ctx({}), 'gstd_publish_task', { package: 'left-pad', funding: 'commercial', budgetNano: '1' });
        expect(noToken.result.isError).toBe(true);
        expect(noToken.result.content[0].text).toMatch(/disabled/);
        const badArgs = await call(ctx({}, 't'), 'gstd_publish_task', { package: 'left-pad', funding: 'free', budgetNano: '1' });
        expect(badArgs.result.isError).toBe(true);
        const extra = await call(ctx({}), 'gstd_query_entity', { entity: 'npm:x', adminToken: 'x' });
        expect(extra.result.isError).toBe(true);
    });

    it('sends the admin token only as a header when publishing', async () => {
        let seen: RequestInit | undefined;
        const c = ctx({ '/sov/admin/publish': init => { seen = init; return json({ taskId: 'f'.repeat(64) }); } }, 'secret');
        const r = await call(c, 'gstd_publish_task', { package: 'left-pad', funding: 'subsidized', budgetNano: '5' });
        expect(JSON.parse(r.result.content[0].text).taskId).toBe('f'.repeat(64));
        expect((seen!.headers as Record<string, string>)['x-sov-admin']).toBe('secret');
        expect(String(seen!.body)).not.toContain('secret');
    });

    it('rejects unknown tools', async () => {
        const r = await call(ctx({}), 'drop_database');
        expect(r.error.code).toBe(-32602);
    });
});
