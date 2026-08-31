export interface ModelEntry {
    license: string;
    commercial: boolean;
    tags: string[];
    ram_required_gb: number; // minimum system RAM to load this model
}

export const MODEL_REGISTRY: Readonly<Record<string, ModelEntry>> = Object.freeze({
    // ── Ultra-light / minimal ─── RAM ≤ 2 GB ─────────────────────────────────
    'llama3.2:1b':       { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'],                       ram_required_gb: 2 },
    'gemma3:1b':         { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'],                       ram_required_gb: 2 },
    'qwen2.5:0.5b':      { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'math'], ram_required_gb: 1 },
    'smollm2:360m':      { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'],                       ram_required_gb: 1 },
    'moondream':         { license: 'Apache-2.0',                       commercial: true,  tags: ['vision'],                     ram_required_gb: 2 },
    'nomic-embed-text':  { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'search'],            ram_required_gb: 2 },
    'all-minilm':        { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'similarity'],        ram_required_gb: 1 },

    // ── Light (2-5 GB) ─── RAM 4 GB ──────────────────────────────────────────
    'llama3.2:3b':       { license: 'Meta Llama 3.2 Community License', commercial: true,  tags: ['chat'],                       ram_required_gb: 4 },
    'qwen2.5:3b':        { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'],       ram_required_gb: 4 },
    'phi4-mini:3.8b':    { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 4 },
    'gemma3:4b':         { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'],                       ram_required_gb: 4 },
    'qwen2.5-coder:3b':  { license: 'Qwen License',                     commercial: true,  tags: ['code'],                       ram_required_gb: 4 },
    'deepseek-r1:1.5b':  { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 2 },
    'tinyllama:1.1b':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'],                       ram_required_gb: 2 },
    'orca-mini:3b':      { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat'],                       ram_required_gb: 4 },

    // ── Standard (5-12 GB) ─── RAM 8 GB ──────────────────────────────────────
    'llama3.1:8b':       { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 8 },
    'qwen2.5:7b':        { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual'],       ram_required_gb: 8 },
    'qwen2.5-coder:7b':  { license: 'Qwen License',                     commercial: true,  tags: ['code'],                       ram_required_gb: 8 },
    'deepseek-r1:7b':    { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 8 },
    'mistral:7b':        { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'],                       ram_required_gb: 8 },
    'mistral-nemo:12b':  { license: 'Apache-2.0',                       commercial: true,  tags: ['chat', 'multilingual'],       ram_required_gb: 12 },
    'gemma3:12b':        { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'],                       ram_required_gb: 12 },
    'llava:7b':          { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'],             ram_required_gb: 8 },
    'llava:13b':         { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'],             ram_required_gb: 12 },
    'codellama:7b':      { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'],                       ram_required_gb: 8 },
    'codellama:13b':     { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'],                       ram_required_gb: 12 },
    'aya:8b':            { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat', 'multilingual'],       ram_required_gb: 8 },
    'neural-chat:7b':    { license: 'Intel Neural Chat License',        commercial: true,  tags: ['chat'],                       ram_required_gb: 8 },
    'starling-lm:7b':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'],                       ram_required_gb: 8 },
    'mxbai-embed-large': { license: 'Apache-2.0',                       commercial: true,  tags: ['embed', 'search'],            ram_required_gb: 4 },

    // ── Powerful (12-30 GB) ─── RAM 16 GB ────────────────────────────────────
    'qwen2.5:14b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'], ram_required_gb: 16 },
    'deepseek-r1:14b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 16 },
    'phi4:14b':               { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 16 },
    'qwen2.5-coder:14b':      { license: 'Qwen License',                     commercial: true,  tags: ['code'],                       ram_required_gb: 16 },
    'gemma3:27b':             { license: 'Gemma Terms of Use',               commercial: true,  tags: ['chat'],                       ram_required_gb: 24 },
    'mistral-small3.1:22b':   { license: 'Apache-2.0',                       commercial: true,  tags: ['chat', 'vision'],             ram_required_gb: 24 },
    'aya-expanse:32b':        { license: 'CC-BY-NC-4.0',                     commercial: false, tags: ['chat', 'multilingual'],       ram_required_gb: 32 },
    'codellama:34b':          { license: 'Meta Llama 2 Community License',   commercial: true,  tags: ['code'],                       ram_required_gb: 32 },
    'llava:34b':              { license: 'Apache-2.0',                       commercial: true,  tags: ['vision', 'chat'],             ram_required_gb: 32 },

    // ── Maximum (30+ GB) ─── RAM 32 GB+ ──────────────────────────────────────
    'qwen2.5:32b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'], ram_required_gb: 32 },
    'deepseek-r1:32b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 32 },
    'qwen2.5-coder:32b':      { license: 'Qwen License',                     commercial: true,  tags: ['code'],                       ram_required_gb: 32 },
    'codestral:22b':          { license: 'Mistral AI Non-Production License', commercial: false, tags: ['code'],                      ram_required_gb: 24 },
    'deepseek-r1:70b':        { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 48 },
    'llama3.3:70b':           { license: 'Meta Llama 3.3 Community License', commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 48 },
    'qwen2.5:72b':            { license: 'Qwen License',                     commercial: true,  tags: ['chat', 'multilingual', 'reasoning'], ram_required_gb: 48 },

    // ── Legacy entries ────────────────────────────────────────────────────────
    'llama3.1:70b':           { license: 'Meta Llama 3.1 Community License', commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 48 },
    'mistral:7b-instruct':    { license: 'Apache-2.0',                       commercial: true,  tags: ['chat'],                       ram_required_gb: 8 },
    'phi3:medium':            { license: 'MIT',                              commercial: true,  tags: ['chat', 'reasoning'],          ram_required_gb: 8 },
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

export function getModelRamRequirement(modelId: string): number {
    // Strip quantization suffixes like :q4_0, :q8_0 from lookup key
    const base = modelId.split(':q')[0] + (modelId.includes(':') && !modelId.includes(':q') ? ':' + modelId.split(':')[1] : '');
    return MODEL_REGISTRY[modelId]?.ram_required_gb ?? MODEL_REGISTRY[base]?.ram_required_gb ?? 8;
}

/** Returns true if the model's RAM requirement fits within availableRamGb. */
export function modelFitsInRam(modelId: string, availableRamGb: number): boolean {
    return getModelRamRequirement(modelId) <= availableRamGb;
}
