#!/usr/bin/env node
/**
 * Minimal MCP (Model Context Protocol) server over stdio for a sovereign node.
 * Newline-delimited JSON-RPC 2.0. No extra dependencies.
 *
 *   node --import tsx src/sovereign/mcp.ts --node http://127.0.0.1:PORT
 *
 * Read tools need nothing else. Publishing needs the node's admin token in
 * GSTD_SOV_ADMIN_TOKEN (it is never accepted as a tool argument).
 */

import { createInterface } from 'readline';
import { z } from 'zod';
import { verifyProofBundle, type ProofBundle } from './board.js';

export interface McpContext {
    nodeUrl: string;
    adminToken?: string;
    fetchImpl?: typeof fetch;
}

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }

const TOOLS = [
    {
        name: 'gstd_network_status',
        description: 'Node identity, roles, object count and known peers of the connected GSTD sovereign node.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'gstd_list_tasks',
        description: 'All tasks known to the node with their derived status (unassigned, leased, awaiting-verification, accepted, rejected, expired).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'gstd_query_entity',
        description: 'Latest independently verified data for an entity such as npm:left-pad, with hash-chained history. The proof bundle is re-verified offline by this tool. A matching hash proves integrity, not that the source was truthful.',
        inputSchema: { type: 'object', properties: { entity: { type: 'string', maxLength: 140 } }, required: ['entity'], additionalProperties: false },
    },
    {
        name: 'gstd_publish_task',
        description: 'Publish a data.fetch task for an npm package. Requires GSTD_SOV_ADMIN_TOKEN. Budgets are accounting values; no real payout is executed.',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string' },
                funding: { type: 'string', enum: ['commercial', 'subsidized'] },
                budgetNano: { type: 'string', pattern: '^\\d{1,30}$' },
                minVerifiers: { type: 'integer', minimum: 1, maximum: 5 },
                backups: { type: 'array', items: { type: 'string', pattern: '^[0-9a-f]{64}$' }, maxItems: 3 },
            },
            required: ['package', 'funding', 'budgetNano'],
            additionalProperties: false,
        },
    },
] as const;

const EntityArgs = z.object({ entity: z.string().min(1).max(140) }).strict();
const PublishArgs = z.object({
    package: z.string().min(1).max(120),
    funding: z.enum(['commercial', 'subsidized']),
    budgetNano: z.string().regex(/^\d{1,30}$/),
    minVerifiers: z.number().int().min(1).max(5).optional(),
    backups: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(3).optional(),
}).strict();

async function nodeCall(ctx: McpContext, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const f = ctx.fetchImpl ?? fetch;
    const resp = await f(`${ctx.nodeUrl.replace(/\/+$/, '')}${path}`, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const text = await resp.text();
    let body: unknown; try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
    return { status: resp.status, body };
}

async function callTool(ctx: McpContext, name: string, args: unknown): Promise<unknown> {
    switch (name) {
        case 'gstd_network_status': {
            const [health, sync] = await Promise.all([nodeCall(ctx, '/sov/health'), nodeCall(ctx, '/sov/sync')]);
            return { ...health.body, peers: Array.isArray(sync.body.peers) ? sync.body.peers : [] };
        }
        case 'gstd_list_tasks':
            return (await nodeCall(ctx, '/sov/tasks')).body;
        case 'gstd_query_entity': {
            const { entity } = EntityArgs.parse(args ?? {});
            const r = await nodeCall(ctx, `/sov/query?entity=${encodeURIComponent(entity)}`);
            if (r.status !== 200) return r.body;
            const proof = r.body.current?.proof as ProofBundle | null | undefined;
            const check = proof ? verifyProofBundle(proof) : { ok: false, reason: 'no proof bundle' };
            return { ...r.body, proofVerifiedOffline: check.ok, proofReason: check.reason };
        }
        case 'gstd_publish_task': {
            if (!ctx.adminToken) throw new Error('GSTD_SOV_ADMIN_TOKEN is not set; publishing is disabled');
            const input = PublishArgs.parse(args ?? {});
            const r = await nodeCall(ctx, '/sov/admin/publish', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-sov-admin': ctx.adminToken },
                body: JSON.stringify(input),
            });
            if (r.status !== 200) throw new Error(`publish failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
            return r.body;
        }
        default:
            throw new Error(`unknown tool: ${name}`);
    }
}

/** Returns the JSON-RPC response, or null for notifications. */
export async function handleRpc(req: RpcRequest, ctx: McpContext): Promise<object | null> {
    const id = req.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return fail(-32600, 'invalid request');
    if (req.id === undefined) return null;

    switch (req.method) {
        case 'initialize':
            return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'gstd-sovereign', version: '1.0.0' } });
        case 'ping':
            return ok({});
        case 'tools/list':
            return ok({ tools: TOOLS });
        case 'tools/call': {
            const p = req.params as { name?: unknown; arguments?: unknown } | undefined;
            if (!p || typeof p.name !== 'string') return fail(-32602, 'tool name required');
            if (!TOOLS.some(t => t.name === p.name)) return fail(-32602, `unknown tool: ${p.name}`);
            try {
                const result = await callTool(ctx, p.name, p.arguments);
                return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
            } catch (err) {
                const msg = err instanceof z.ZodError ? `invalid arguments: ${err.issues[0]?.message ?? 'schema'}` : (err as Error).message;
                return ok({ isError: true, content: [{ type: 'text', text: msg.slice(0, 500) }] });
            }
        }
        default:
            return fail(-32601, `method not found: ${req.method}`);
    }
}

async function main(): Promise<void> {
    const i = process.argv.indexOf('--node');
    const nodeUrl = (i > -1 ? process.argv[i + 1] : process.env.GSTD_SOV_NODE_URL) ?? 'http://127.0.0.1:7777';
    const ctx: McpContext = { nodeUrl, adminToken: process.env.GSTD_SOV_ADMIN_TOKEN };
    const rl = createInterface({ input: process.stdin });
    rl.on('line', line => {
        if (!line.trim()) return;
        let req: RpcRequest;
        try { req = JSON.parse(line); } catch {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
            return;
        }
        void handleRpc(req, ctx).then(res => { if (res) process.stdout.write(JSON.stringify(res) + '\n'); });
    });
}

if (process.argv[1] && /mcp\.[tj]s$/.test(process.argv[1])) void main();
