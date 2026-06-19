/**
 * Odysseus Adapter
 * Wraps Odysseus HTTP API in OpenAI-compatible /v1/chat/completions format.
 * AGPL compliance: gstdbot calls Odysseus as a separate process via HTTP,
 * no Odysseus source is modified or bundled.
 */

import type { IncomingMessage, ServerResponse } from 'http';

const ODYSSEUS_URL = (process.env.ODYSSEUS_URL || 'http://localhost:7000').replace(/\/$/, '');

type OllamaMessage = { role: string; content: string };

// Map GSTD model IDs to Odysseus endpoints + actions
const MODEL_ENDPOINT: Record<string, { path: string; action: 'chat' | 'search' | 'docs' }> = {
    'odysseus-chat':     { path: '/api/chat',   action: 'chat'   },
    'odysseus-research': { path: '/api/search',  action: 'search' },
    'odysseus-docs':     { path: '/api/chat',   action: 'docs'   },
};

function buildOdysseusBody(model: string, messages: OllamaMessage[]): object {
    const lastMsg = messages[messages.length - 1]?.content || '';
    const history = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    const ep = MODEL_ENDPOINT[model];

    if (ep?.action === 'search') {
        return { query: lastMsg, history };
    }
    if (ep?.action === 'docs') {
        return { message: lastMsg, history, mode: 'document_analysis' };
    }
    return { message: lastMsg, history };
}

function wrapAsOpenAI(content: string, model: string, taskId: string): object {
    return {
        id:      `chatcmpl-${taskId}`,
        object:  'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index:         0,
            message:       { role: 'assistant', content },
            finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        _gstd: { via: 'odysseus', model },
    };
}

/**
 * Handle an incoming OpenAI-format request and proxy it to Odysseus.
 * Returns { handled: true } if Odysseus responded, { handled: false } otherwise.
 */
export async function handleOdysseus(
    model: string,
    messages: OllamaMessage[],
    taskId: string,
): Promise<{ handled: true; response: object } | { handled: false }> {
    const ep = MODEL_ENDPOINT[model];
    if (!ep) return { handled: false };

    const odBody = buildOdysseusBody(model, messages);

    try {
        const resp = await fetch(`${ODYSSEUS_URL}${ep.path}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(odBody),
            signal:  AbortSignal.timeout(55_000),
        });

        if (!resp.ok) return { handled: false };

        const data: any = await resp.json();

        // Odysseus response shape: { response, answer, content, text } (varies by endpoint)
        const content: string =
            data.response  ||
            data.answer    ||
            data.content   ||
            data.text      ||
            data.summary   ||
            JSON.stringify(data);

        return { handled: true, response: wrapAsOpenAI(content, model, taskId) };

    } catch {
        return { handled: false };
    }
}
