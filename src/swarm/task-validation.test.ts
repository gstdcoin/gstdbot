import { describe, expect, it } from 'vitest';
import {
    isValidFinetuneIdentifier,
    MAX_INFERENCE_RESPONSE_BYTES,
    readBoundedResponseText,
    SUPPORTED_TASK_KINDS,
    validateInferenceTaskInput,
    validateMemoryTaskInput,
} from './task-validation.js';

describe('finetune task identifiers', () => {
    it('accepts bounded task and job identifiers', () => {
        expect(isValidFinetuneIdentifier('job_1a2b-3c')).toBe(true);
        expect(isValidFinetuneIdentifier('11111111-1111-1111-1111-111111111111')).toBe(true);
    });

    it('rejects path traversal and non-string identifiers', () => {
        expect(isValidFinetuneIdentifier('../../outside')).toBe(false);
        expect(isValidFinetuneIdentifier('..\\outside')).toBe(false);
        expect(isValidFinetuneIdentifier('a'.repeat(129))).toBe(false);
        expect(isValidFinetuneIdentifier({ toString: () => 'safe' })).toBe(false);
    });
});

describe('inference task input', () => {
    const validInput = {
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 2048,
        temperature: 0.7,
    };

    it('accepts a bounded, supported inference request', () => {
        expect(validateInferenceTaskInput(validInput)).toEqual(validInput);
    });

    it('rejects invalid roles, oversized messages and token limits', () => {
        expect(validateInferenceTaskInput({
            ...validInput,
            messages: [{ role: 'tool', content: 'hello' }],
        })).toBeNull();
        expect(validateInferenceTaskInput({
            ...validInput,
            messages: [{ role: 'user', content: 'x'.repeat(8_001) }],
        })).toBeNull();
        expect(validateInferenceTaskInput({ ...validInput, max_tokens: 2_049 })).toBeNull();
    });

    it('rejects encoded requests larger than 32 KiB', () => {
        expect(validateInferenceTaskInput({
            ...validInput,
            messages: Array(4).fill({ role: 'user', content: 'é'.repeat(4_200) }),
        })).toBeNull();
    });
});

describe('memory task input', () => {
    it('normalizes supported bounded storage, embedding, and verification tasks', () => {
        expect(validateMemoryTaskInput({
            id: 'task-1',
            type: 'embedding',
            prompt: 'fallback',
            payload: { text: 'embed this' },
        })).toEqual({ type: 'embedding', id: 'task-1', text: 'embed this' });
        expect(validateMemoryTaskInput({
            id: 'task-2',
            type: 'storage',
            payload: { key: 'user-key', value: 'stored value' },
        })).toEqual({ type: 'storage', key: 'user-key', value: 'stored value' });
        expect(validateMemoryTaskInput({
            type: 'verification',
            prompt: 'question',
            payload: { expected_answer: 'answer' },
        })).toEqual({ type: 'verification', prompt: 'question', expectedAnswer: 'answer' });
    });

    it('rejects oversized UTF-8 values and malformed task payloads', () => {
        expect(validateMemoryTaskInput({
            id: 'task-3',
            type: 'embedding',
            payload: { text: 'é'.repeat(16_385) },
        })).toBeNull();
        expect(validateMemoryTaskInput({
            id: 'task-4',
            type: 'storage',
            payload: { key: 'x'.repeat(257), value: 'small' },
        })).toBeNull();
        expect(validateMemoryTaskInput({
            type: 'verification',
            prompt: 'valid',
            payload: { expected_answer: 42 },
        })).toBeNull();
    });
});

describe('advertised task support', () => {
    it('excludes task types that are disabled or unsupported', () => {
        expect(SUPPORTED_TASK_KINDS).toEqual(['inference', 'embedding', 'verification', 'storage']);
        expect(SUPPORTED_TASK_KINDS).not.toContain('finetune');
        expect(SUPPORTED_TASK_KINDS).not.toContain('bridge_verify');
    });
});

describe('inference backend response bounds', () => {
    it('reads responses within the configured byte limit', async () => {
        const response = new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));

        await expect(readBoundedResponseText(response)).resolves.toContain('"content":"ok"');
    });

    it('rejects oversized declared content before reading the body', async () => {
        const response = new Response('ignored', {
            headers: { 'content-length': String(MAX_INFERENCE_RESPONSE_BYTES + 1) },
        });

        await expect(readBoundedResponseText(response)).rejects.toThrow('exceeds');
    });

    it('rejects oversized chunked bodies while streaming', async () => {
        const response = new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(MAX_INFERENCE_RESPONSE_BYTES));
                controller.enqueue(new Uint8Array([1]));
                controller.close();
            },
        }));

        await expect(readBoundedResponseText(response)).rejects.toThrow('exceeds');
    });
});
