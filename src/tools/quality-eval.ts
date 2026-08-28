/**
 * Quality Evaluation Tool — GSTD Sovereign Network
 * Compares GSTD free/standard tiers against single-model baselines.
 * Uses local Ollama as judge (no external AI dependencies).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NeuralRouter, type ChatMessage, type SmartMixTier } from '../gateway/router.js';

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');

type CandidateResult = { id: string; label: string; content: string };
type JudgeScore = { id: string; overall: number; correctness: number; depth: number; actionability: number; clarity: number; safety: number; rationale: string };
type JudgeResponse = { ranking: string[]; scores: JudgeScore[]; winner: string; summary: string };

const PROMPTS: Array<{ name: string; text: string }> = [
    {
        name: 'distributed_system_debug',
        text: 'A distributed job queue has duplicate processing, retry storms, and occasional data loss. Provide a production-ready diagnosis and fix plan with architecture changes, idempotency strategy, rollback plan, and concrete metrics.',
    },
    {
        name: 'security_incident_response',
        text: 'Our API key leaked in logs for 2 hours. Build an incident response playbook: containment, key rotation, blast-radius analysis, user comms, and follow-up controls. Be practical and specific.',
    },
    {
        name: 'algorithm_design',
        text: 'Design a high-throughput rate limiter for global API traffic (multi-region), with strict per-tenant quotas, burst support, and graceful degradation. Include data structures, consistency model, and failure handling.',
    },
];

const BASELINE_MODELS = [
    { id: 'baseline_llama3b', label: 'Baseline llama3.2:3b', model: 'llama3.2:3b' },
    { id: 'baseline_llama8b', label: 'Baseline llama3.1:8b', model: 'llama3.1:8b' },
];

async function callOllama(model: string, messages: ChatMessage[], maxTokens = 1600, temperature = 0.4): Promise<string> {
    const resp = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text().catch(() => '')}`);
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('Empty Ollama response');
    return content;
}

function sanitizeForJudge(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s+/g, ' ').trim().slice(0, 3500);
}

async function judge(prompt: string, candidates: CandidateResult[]): Promise<JudgeResponse> {
    const payload = candidates.map(c => `ID: ${c.id}\nLABEL: ${c.label}\nANSWER:\n${sanitizeForJudge(c.content)}`).join('\n\n---\n\n');
    const judgeMessages: ChatMessage[] = [
        { role: 'system', content: 'You are a strict and unbiased AI answer evaluator. Return valid JSON only.' },
        {
            role: 'user',
            content: `Task prompt:\n${prompt}\n\nCandidates:\n${payload}\n\nReturn ONLY JSON: {"ranking":["id1","id2"],"winner":"id","summary":"...","scores":[{"id":"...","overall":0-10,"correctness":0-10,"depth":0-10,"actionability":0-10,"clarity":0-10,"safety":0-10,"rationale":"..."}]}`,
        },
    ];

    // Use best available Ollama model for judging
    let judgeModel = 'llama3.2:3b';
    try {
        const tags: any = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
        const models: string[] = (tags.models || []).map((m: any) => m.name as string);
        const preferred = ['llama3.1:8b', 'qwen2.5:7b', 'mistral:7b', 'llama3.2:3b'];
        for (const p of preferred) {
            if (models.some(m => m.startsWith(p.split(':')[0]))) { judgeModel = p; break; }
        }
        if (judgeModel === 'llama3.2:3b' && models.length > 0) judgeModel = models[0];
    } catch { /* use default */ }

    const raw = await callOllama(judgeModel, judgeMessages, 1400, 0.1);
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('Judge returned non-JSON output');
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as JudgeResponse;
}

async function run(): Promise<void> {
    console.log(`[quality-eval] Using Ollama at ${OLLAMA_URL}`);

    const router = new NeuralRouter(process.env.GSTD_SWARM_URL || 'https://platform.gstdtoken.com', true);
    const reportLines: string[] = [
        '# Quality Evaluation Report',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        'Compared candidates: our_free, our_standard, baseline_llama3b, baseline_llama8b',
        '',
    ];

    const winCount: Record<string, number> = { our_free: 0, our_standard: 0, baseline_llama3b: 0, baseline_llama8b: 0 };

    for (const p of PROMPTS) {
        const chatMessages: ChatMessage[] = [{ role: 'user', content: p.text }];
        const tiers: SmartMixTier[] = ['free', 'standard'];

        const ourResults = await Promise.all(
            tiers.map(async tier => {
                const out = await router.routeSmartMix(tier, chatMessages);
                return { id: tier === 'free' ? 'our_free' : 'our_standard', label: tier === 'free' ? 'Our Free Mode' : 'Our Paid Standard Mode', content: out.content } as CandidateResult;
            })
        );

        const baselineResults = await Promise.all(
            BASELINE_MODELS.map(async b => {
                const content = await callOllama(b.model, [
                    { role: 'system', content: 'Provide the best possible answer with strong correctness, depth, and practical value.' },
                    { role: 'user', content: p.text },
                ], 2000, 0.4);
                return { id: b.id, label: b.label, content } as CandidateResult;
            })
        );

        const candidates = [...ourResults, ...baselineResults];
        const judged = await judge(p.text, candidates);
        const winnerId = judged.ranking?.[0] || judged.winner;
        if (winnerId && winCount[winnerId] !== undefined) winCount[winnerId] += 1;

        reportLines.push(`## Prompt: ${p.name}`, '', `Winner: \`${winnerId}\``, `Ranking: ${judged.ranking.map(x => `\`${x}\``).join(' > ')}`, '');
        reportLines.push('| Candidate | Overall | Correctness | Depth | Actionability | Clarity | Safety |', '|---|---:|---:|---:|---:|---:|---:|');
        for (const s of judged.scores) {
            reportLines.push(`| \`${s.id}\` | ${s.overall} | ${s.correctness} | ${s.depth} | ${s.actionability} | ${s.clarity} | ${s.safety} |`);
        }
        reportLines.push('', `Judge summary: ${judged.summary}`, '');
    }

    reportLines.push('## Aggregate Wins', '',
        `- our_free: ${winCount.our_free}/${PROMPTS.length}`,
        `- our_standard: ${winCount.our_standard}/${PROMPTS.length}`,
        `- baseline_llama3b: ${winCount.baseline_llama3b}/${PROMPTS.length}`,
        `- baseline_llama8b: ${winCount.baseline_llama8b}/${PROMPTS.length}`,
    );

    const reportsDir = join(process.cwd(), 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const outPath = join(reportsDir, `quality-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    writeFileSync(outPath, reportLines.join('\n'));
    console.log(`Quality report written: ${outPath}`);
}

run().catch((err) => {
    console.error('quality-eval failed:', err?.message || err);
    process.exit(1);
});
