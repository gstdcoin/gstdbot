export interface ModelEntry {
    license: string;
    commercial: boolean;
    tags: string[];
}

export const MODEL_REGISTRY: Readonly<Record<string, ModelEntry>> = Object.freeze({
    'llama3.2:3b':  { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'] },
    'llama3.1:8b':  { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'llama3.1:70b': { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5:7b':   { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'] },
    'qwen2.5:32b':  { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'] },
    'mistral:7b':   { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'phi3:medium':  { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
});

export function isRegistered(modelId: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, modelId);
}

export function getEntry(modelId: string): ModelEntry | undefined {
    return MODEL_REGISTRY[modelId];
}
