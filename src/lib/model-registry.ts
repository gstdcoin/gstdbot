export interface ModelEntry {
    license: string;
    commercial: boolean;
    tags: string[];
}

export const MODEL_REGISTRY: Readonly<Record<string, ModelEntry>> = Object.freeze({
    // ── Ultra-light / minimal ─────────────────────────────────────────────────
    'llama3.2:1b':       { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'] },
    'gemma3:1b':         { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'] },
    'qwen2.5:0.5b':      { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'math'] },
    'smollm2:360m':      { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'moondream':         { license: 'Apache-2.0',                       commercial: true,  tags: ['vision'] },
    'nomic-embed-text':  { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'search'] },
    'all-minilm':        { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'similarity'] },

    // ── Light (2-5 GB) ────────────────────────────────────────────────────────
    'llama3.2:3b':       { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'] },
    'qwen2.5:3b':        { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'] },
    'phi4-mini:3.8b':    { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'gemma3:4b':         { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'] },
    'qwen2.5-coder:3b':  { license: 'Qwen License',                     commercial: true,  tags: ['code'] },
    'deepseek-r1:1.5b':  { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'tinyllama:1.1b':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'orca-mini:3b':      { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat'] },

    // ── Standard (5-12 GB) ────────────────────────────────────────────────────
    'llama3.1:8b':       { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5:7b':        { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'] },
    'qwen2.5-coder:7b':  { license: 'Qwen License',                     commercial: true,  tags: ['code'] },
    'deepseek-r1:7b':    { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'mistral:7b':        { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'mistral-nemo:12b':  { license: 'Apache-2.0',                       commercial: true,  tags: ['chat', 'multilingual'] },
    'gemma3:12b':        { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'] },
    'llava:7b':          { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'] },
    'llava:13b':         { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'] },
    'codellama:7b':      { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'] },
    'codellama:13b':     { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'] },
    'aya:8b':            { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat', 'multilingual'] },
    'neural-chat:7b':    { license: 'Intel Neural Chat License',        commercial: true,  tags: ['chat'] },
    'starling-lm:7b':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'mxbai-embed-large': { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'search'] },

    // ── Powerful (12-30 GB) ───────────────────────────────────────────────────
    'qwen2.5:14b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'] },
    'deepseek-r1:14b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'phi4:14b':               { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5-coder:14b':      { license: 'Qwen License',                     commercial: true,  tags: ['code'] },
    'gemma3:27b':             { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'] },
    'mistral-small3.1:22b':   { license: 'Apache-2.0',                       commercial: true,  tags: ['chat', 'vision'] },
    'aya-expanse:32b':        { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat', 'multilingual'] },
    'codellama:34b':          { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'] },
    'llava:34b':              { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'] },

    // ── Maximum (30+ GB) ──────────────────────────────────────────────────────
    'qwen2.5:32b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'] },
    'deepseek-r1:32b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5-coder:32b':      { license: 'Qwen License',                     commercial: true,  tags: ['code'] },
    'codestral:22b':          { license: 'Mistral AI Non-Production License', commercial: false, tags: ['code'] },
    'deepseek-r1:70b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
    'llama3.3:70b':           { license: 'Meta Llama 3.3 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'qwen2.5:72b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'] },

    // ── Legacy entries ────────────────────────────────────────────────────────
    'llama3.1:70b':           { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'] },
    'mistral:7b-instruct':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'] },
    'phi3:medium':            { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'] },
});

export function isRegistered(modelId: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, modelId);
}

export function getEntry(modelId: string): ModelEntry | undefined {
    return MODEL_REGISTRY[modelId];
}

export function isCommerciallyLicensed(modelId: string): boolean {
    return MODEL_REGISTRY[modelId]?.commercial ?? false;
}
