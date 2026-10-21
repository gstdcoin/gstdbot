import { Buffer } from 'node:buffer';

const SAFE_FINETUNE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_INFERENCE_RESPONSE_BYTES = 1024 * 1024;
export const SUPPORTED_TASK_KINDS = ['inference', 'embedding', 'verification', 'storage'] as const;

export function isValidFinetuneIdentifier(value: unknown): value is string {
    return typeof value === 'string' && SAFE_FINETUNE_ID.test(value);
}

export interface InferenceTaskInput {
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    max_tokens: number;
    temperature: number;
}

export type MemoryTaskInput =
    | { type: 'embedding'; id: string; text: string }
    | { type: 'verification'; prompt: string; expectedAnswer?: string }
    | { type: 'storage'; key: string; value: string };

const MAX_MEMORY_TASK_TEXT_BYTES = 32 * 1024;
const MAX_MEMORY_TASK_KEY_BYTES = 256;

export function validateMemoryTaskInput(value: unknown): MemoryTaskInput | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const task = value as Record<string, unknown>;
    const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
        ? task.payload as Record<string, unknown>
        : {};

    if (task.type === 'embedding') {
        const id = task.id;
        const text = payload.text ?? task.prompt ?? '';
        if (
            typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id, 'utf8') > MAX_MEMORY_TASK_KEY_BYTES
            || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_MEMORY_TASK_TEXT_BYTES
        ) {
            return null;
        }
        return { type: 'embedding', id, text };
    }

    if (task.type === 'verification') {
        const prompt = task.prompt ?? '';
        const expectedAnswer = payload.expected_answer;
        if (
            typeof prompt !== 'string' || Buffer.byteLength(prompt, 'utf8') > 8_000
            || (expectedAnswer !== undefined
                && (typeof expectedAnswer !== 'string' || Buffer.byteLength(expectedAnswer, 'utf8') > 8_000))
        ) {
            return null;
        }
        return {
            type: 'verification',
            prompt,
            ...(typeof expectedAnswer === 'string' ? { expectedAnswer } : {}),
        };
    }

    if (task.type === 'storage') {
        const key = payload.key ?? task.id;
        const storedValue = payload.value ?? '';
        if (
            typeof key !== 'string' || key.length === 0 || Buffer.byteLength(key, 'utf8') > MAX_MEMORY_TASK_KEY_BYTES
            || typeof storedValue !== 'string'
            || Buffer.byteLength(storedValue, 'utf8') > MAX_MEMORY_TASK_TEXT_BYTES
        ) {
            return null;
        }
        return { type: 'storage', key, value: storedValue };
    }

    return null;
}

export function validateInferenceTaskInput(value: unknown): InferenceTaskInput | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (
        typeof input.model !== 'string'
        || input.model.length === 0
        || input.model.length > 100
        || !Array.isArray(input.messages)
        || input.messages.length < 1
        || input.messages.length > 32
        || typeof input.max_tokens !== 'number'
        || !Number.isSafeInteger(input.max_tokens)
        || input.max_tokens < 1
        || input.max_tokens > 2048
        || typeof input.temperature !== 'number'
        || !Number.isFinite(input.temperature)
        || input.temperature < 0
        || input.temperature > 2
    ) {
        return null;
    }

    let totalChars = 0;
    const messages: InferenceTaskInput['messages'] = [];
    for (const message of input.messages) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
        const candidate = message as Record<string, unknown>;
        if (
            (candidate.role !== 'system' && candidate.role !== 'user' && candidate.role !== 'assistant')
            || typeof candidate.content !== 'string'
            || candidate.content.length > 8_000
        ) {
            return null;
        }
        totalChars += candidate.content.length;
        if (totalChars > 32 * 1024) return null;
        messages.push({ role: candidate.role, content: candidate.content });
    }

    const normalized: InferenceTaskInput = {
        model: input.model,
        messages,
        max_tokens: input.max_tokens,
        temperature: input.temperature,
    };
    if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 32 * 1024) return null;

    return normalized;
}

export async function readBoundedResponseText(
    response: Response,
    maxBytes: number = MAX_INFERENCE_RESPONSE_BYTES,
): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel();
        throw new Error(`Inference backend response exceeds ${maxBytes} bytes`);
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) {
                await reader.cancel();
                throw new Error(`Inference backend response exceeds ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
