"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const router_js_1 = require("../gateway/router.js");
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
if (!GROQ_KEY) {
    throw new Error('GROQ_API_KEY is required for quality evaluation');
}
const PROMPTS = [
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
    { id: 'baseline_llama70b', label: 'Baseline Llama 70B', model: 'llama-3.3-70b-versatile' },
    { id: 'baseline_qwen32b', label: 'Baseline Qwen 32B', model: 'qwen/qwen3-32b' },
];
async function callGroq(model, messages, maxTokens = 1600, temperature = 0.4) {
    const retryModels = [model, 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
    let lastError = 'unknown';
    for (const selectedModel of retryModels) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const resp = await fetch(GROQ_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${GROQ_KEY}`,
                },
                body: JSON.stringify({
                    model: selectedModel,
                    messages,
                    max_tokens: maxTokens,
                    temperature,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                const content = data?.choices?.[0]?.message?.content || '';
                if (content)
                    return content;
                lastError = `Empty response from ${selectedModel}`;
            }
            else {
                const err = await resp.text().catch(() => '');
                lastError = `Groq ${resp.status}: ${err.slice(0, 120)}`;
                if (resp.status === 429) {
                    await new Promise(r => setTimeout(r, 1200 * attempt));
                    continue;
                }
            }
            break;
        }
    }
    throw new Error(lastError);
}
function sanitizeForJudge(text) {
    return text
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3500);
}
async function judge(prompt, candidates) {
    const payload = candidates.map(c => `ID: ${c.id}\nLABEL: ${c.label}\nANSWER:\n${sanitizeForJudge(c.content)}`).join('\n\n---\n\n');
    const judgeMessages = [
        {
            role: 'system',
            content: 'You are a strict and unbiased AI answer evaluator. Evaluate quality only. Do not reward style over correctness. Prefer factual, deep, practical, safe responses. Return valid JSON only.',
        },
        {
            role: 'user',
            content: `Task prompt:\n${prompt}\n\n` +
                `Candidates:\n${payload}\n\n` +
                'Return ONLY JSON with this exact shape: ' +
                '{"ranking":["id1","id2","id3","id4"],"winner":"id","summary":"...","scores":[{"id":"...","overall":0-10,"correctness":0-10,"depth":0-10,"actionability":0-10,"clarity":0-10,"safety":0-10,"rationale":"..."}]}',
        },
    ];
    const raw = await callGroq('openai/gpt-oss-20b', judgeMessages, 1400, 0.1);
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
        throw new Error('Judge returned non-JSON output');
    }
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return parsed;
}
async function run() {
    const router = new router_js_1.NeuralRouter(process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com', true);
    const reportLines = [];
    reportLines.push('# Quality Evaluation Report');
    reportLines.push('');
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push('');
    reportLines.push('Compared candidates:');
    reportLines.push('- our_free (GSTD free mode)');
    reportLines.push('- our_standard (GSTD paid standard mode)');
    reportLines.push('- baseline_llama70b');
    reportLines.push('- baseline_qwen32b');
    reportLines.push('');
    const winCount = {
        our_free: 0,
        our_standard: 0,
        baseline_llama70b: 0,
        baseline_qwen32b: 0,
    };
    for (const p of PROMPTS) {
        const chatMessages = [{ role: 'user', content: p.text }];
        const tiers = ['free', 'standard'];
        const ourResults = await Promise.all(tiers.map(async (tier) => {
            const out = await router.routeSmartMix(tier, chatMessages);
            return {
                id: tier === 'free' ? 'our_free' : 'our_standard',
                label: tier === 'free' ? 'Our Free Mode' : 'Our Paid Standard Mode',
                content: out.content,
            };
        }));
        const baselineResults = await Promise.all(BASELINE_MODELS.map(async (b) => {
            const content = await callGroq(b.model, [
                { role: 'system', content: 'Provide the best possible answer with strong correctness, depth, and practical value.' },
                { role: 'user', content: p.text },
            ], 2000, 0.4);
            return { id: b.id, label: b.label, content };
        }));
        const candidates = [...ourResults, ...baselineResults];
        const judged = await judge(p.text, candidates);
        const winnerId = judged.ranking?.[0] || judged.winner;
        if (winnerId && winCount[winnerId] !== undefined)
            winCount[winnerId] += 1;
        reportLines.push(`## Prompt: ${p.name}`);
        reportLines.push('');
        reportLines.push(`Winner: \`${winnerId}\``);
        reportLines.push(`Ranking: ${judged.ranking.map(x => `\`${x}\``).join(' > ')}`);
        reportLines.push('');
        reportLines.push('| Candidate | Overall | Correctness | Depth | Actionability | Clarity | Safety |');
        reportLines.push('|---|---:|---:|---:|---:|---:|---:|');
        for (const s of judged.scores) {
            reportLines.push(`| \`${s.id}\` | ${s.overall} | ${s.correctness} | ${s.depth} | ${s.actionability} | ${s.clarity} | ${s.safety} |`);
        }
        reportLines.push('');
        reportLines.push(`Judge summary: ${judged.summary}`);
        reportLines.push('');
    }
    reportLines.push('## Aggregate Wins');
    reportLines.push('');
    reportLines.push(`- our_free: ${winCount.our_free}/${PROMPTS.length}`);
    reportLines.push(`- our_standard: ${winCount.our_standard}/${PROMPTS.length}`);
    reportLines.push(`- baseline_llama70b: ${winCount.baseline_llama70b}/${PROMPTS.length}`);
    reportLines.push(`- baseline_qwen32b: ${winCount.baseline_qwen32b}/${PROMPTS.length}`);
    reportLines.push('');
    reportLines.push('Interpretation:');
    reportLines.push('- If our_free is not consistently top-2, improve free-mode synthesis protocol.');
    reportLines.push('- our_standard should dominate strongest baseline on most prompts.');
    const reportsDir = (0, path_1.join)(process.cwd(), 'reports');
    (0, fs_1.mkdirSync)(reportsDir, { recursive: true });
    const outPath = (0, path_1.join)(reportsDir, `quality-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    (0, fs_1.writeFileSync)(outPath, reportLines.join('\n'));
    console.log(`Quality report written: ${outPath}`);
}
run().catch((err) => {
    console.error('quality-eval failed:', err?.message || err);
    process.exit(1);
});
//# sourceMappingURL=quality-eval.js.map