/**
 * GSTD Node — Skills Import & Marketplace
 * 
 * Import skills from:
 * - URLs (any SKILL.md or .tar.gz)
 * - GitHub repos (github.com/user/skill or gist)
 * - GSTD Marketplace (curated skills)
 * - Local files (copy SKILL.md into skills/)
 * - OpenClaw-compatible format
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

export interface Skill {
    name: string;
    description: string;
    version: string;
    author: string;
    source: string;
    installed: string;
    path: string;
    type: 'builtin' | 'imported' | 'custom';
    tags: string[];
}

export interface MarketplaceSkill {
    id: string;
    name: string;
    description: string;
    author: string;
    downloads: number;
    stars: number;
    url: string;
    tags: string[];
    gstdCost: number;  // 0 = free
}

const SKILLS_DIR = join(homedir(), '.config', 'gstdbot', 'skills');
const BUILTIN_DIR = join(__dirname, '..', '..', 'skills');

// ─── Marketplace catalog ────────────────────────────────────────

const MARKETPLACE: MarketplaceSkill[] = [
    {
        id: 'code-gen', name: '🖥️ Code Generator', description: 'Generate code in any language with AI pair programming',
        author: 'GSTD Core', downloads: 3420, stars: 89, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/code-gen',
        tags: ['coding', 'dev'], gstdCost: 0
    },
    {
        id: 'web-research', name: '🔍 Web Research', description: 'Deep web search and synthesis with source verification',
        author: 'GSTD Core', downloads: 2810, stars: 67, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/web-research',
        tags: ['research', 'search'], gstdCost: 0
    },
    {
        id: 'content-writer', name: '✍️ Content Writer', description: 'Professional content creation with SEO optimization',
        author: 'GSTD Core', downloads: 1950, stars: 45, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/content-writer',
        tags: ['writing', 'seo'], gstdCost: 0
    },
    {
        id: 'image-gen', name: '🎨 Image Generation', description: 'Text-to-image with Stable Diffusion via Swarm',
        author: 'GSTD Core', downloads: 4200, stars: 112, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/image-gen',
        tags: ['image', 'art'], gstdCost: 10
    },
    {
        id: 'defi-monitor', name: '📊 DeFi Monitor', description: 'Track DeFi positions, yield, and portfolio across chains',
        author: 'GSTD Core', downloads: 1340, stars: 38, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/defi-monitor',
        tags: ['defi', 'crypto'], gstdCost: 0
    },
    {
        id: 'token-analyzer', name: '🔬 Token Analyzer', description: 'On-chain analysis, whale tracking, smart money alerts',
        author: 'GSTD Core', downloads: 2100, stars: 56, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/token-analyzer',
        tags: ['crypto', 'analysis'], gstdCost: 5
    },
    {
        id: 'planetary-signals', name: '📡 Planetary Signals', description: 'Monitor and sponsor 29 planetary research signals',
        author: 'GSTD Core', downloads: 890, stars: 34, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/planetary-signals',
        tags: ['science', 'climate'], gstdCost: 0
    },
    {
        id: 'smart-contract', name: '📝 Smart Contract Auditor', description: 'AI-powered Solidity/FunC audit with vulnerability detection',
        author: 'Community', downloads: 760, stars: 28, url: 'https://github.com/gstdcoin/skill-contract-audit',
        tags: ['security', 'blockchain'], gstdCost: 20
    },
    {
        id: 'voice-assistant', name: '🎙️ Voice Assistant', description: 'Speech-to-text + text-to-speech for hands-free AI',
        author: 'Community', downloads: 520, stars: 19, url: 'https://github.com/gstdcoin/skill-voice',
        tags: ['voice', 'accessibility'], gstdCost: 15
    },
    {
        id: 'data-analyst', name: '📈 Data Analyst', description: 'CSV/JSON analysis with charts, stats, and insights',
        author: 'Community', downloads: 1100, stars: 42, url: 'https://github.com/gstdcoin/skill-data-analyst',
        tags: ['data', 'analytics'], gstdCost: 0
    },
];

// ─── Core Functions ─────────────────────────────────────────────

export function ensureSkillsDir(): void {
    if (!existsSync(SKILLS_DIR)) {
        mkdirSync(SKILLS_DIR, { recursive: true });
    }
}

export function listInstalled(): Skill[] {
    ensureSkillsDir();
    const skills: Skill[] = [];

    // Built-in skills
    if (existsSync(BUILTIN_DIR)) {
        for (const name of readdirSync(BUILTIN_DIR)) {
            const skillDir = join(BUILTIN_DIR, name);
            if (statSync(skillDir).isDirectory()) {
                const skillFile = join(skillDir, 'SKILL.md');
                if (existsSync(skillFile)) {
                    const meta = parseSkillMd(readFileSync(skillFile, 'utf-8'));
                    skills.push({
                        name: meta.name || name,
                        description: meta.description || '',
                        version: meta.version || '1.0.0',
                        author: meta.author || 'GSTD Core',
                        source: 'builtin',
                        installed: 'built-in',
                        path: skillDir,
                        type: 'builtin',
                        tags: meta.tags || [],
                    });
                }
            }
        }
    }

    // User-installed skills
    for (const name of readdirSync(SKILLS_DIR)) {
        const skillDir = join(SKILLS_DIR, name);
        if (statSync(skillDir).isDirectory()) {
            const metaFile = join(skillDir, 'meta.json');
            if (existsSync(metaFile)) {
                try {
                    const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
                    skills.push({ ...meta, path: skillDir });
                } catch { }
            }
        }
    }

    return skills;
}

export function listMarketplace(): MarketplaceSkill[] {
    return MARKETPLACE;
}

export async function importSkill(source: string): Promise<Skill | null> {
    ensureSkillsDir();

    // Detect source type
    if (source.startsWith('http://') || source.startsWith('https://')) {
        return importFromUrl(source);
    } else if (source.includes('/') && !source.startsWith('.')) {
        // Treat as GitHub shorthand: user/repo
        return importFromUrl(`https://github.com/${source}`);
    } else if (existsSync(source)) {
        return importFromLocal(source);
    } else {
        // Try marketplace
        const mkt = MARKETPLACE.find(s => s.id === source);
        if (mkt) {
            return importFromUrl(mkt.url);
        }
        return null;
    }
}

async function importFromUrl(url: string): Promise<Skill | null> {
    const name = extractSkillName(url);
    const skillDir = join(SKILLS_DIR, name);

    if (existsSync(skillDir)) {
        console.log(`  Skill "${name}" already installed, updating...`);
    }

    mkdirSync(skillDir, { recursive: true });

    // If it's a GitHub repo URL
    if (url.includes('github.com')) {
        const rawUrl = convertToRawUrl(url);

        // Try to fetch SKILL.md directly
        try {
            const resp = await fetch(`${rawUrl}/SKILL.md`).catch(() => null);
            if (resp?.ok) {
                const content = await resp.text();
                writeFileSync(join(skillDir, 'SKILL.md'), content);
                const meta = parseSkillMd(content);
                const skill: Skill = {
                    name: meta.name || name,
                    description: meta.description || '',
                    version: meta.version || '1.0.0',
                    author: meta.author || 'Unknown',
                    source: url,
                    installed: new Date().toISOString(),
                    path: skillDir,
                    type: 'imported',
                    tags: meta.tags || [],
                };
                writeFileSync(join(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
                return skill;
            }
        } catch { }

        // Try git clone
        try {
            const cloneUrl = url.replace(/\/tree\/.*/, '.git');
            execSync(`git clone --depth 1 ${cloneUrl} "${skillDir}" 2>/dev/null`, { timeout: 30000 });
            const skillFile = join(skillDir, 'SKILL.md');
            if (existsSync(skillFile)) {
                const meta = parseSkillMd(readFileSync(skillFile, 'utf-8'));
                const skill: Skill = {
                    name: meta.name || name,
                    description: meta.description || '',
                    version: meta.version || '1.0.0',
                    author: meta.author || 'Unknown',
                    source: url,
                    installed: new Date().toISOString(),
                    path: skillDir,
                    type: 'imported',
                    tags: meta.tags || [],
                };
                writeFileSync(join(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
                return skill;
            }
        } catch { }
    }

    // Generic URL fetch (SKILL.md file)
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const content = await resp.text();
            writeFileSync(join(skillDir, 'SKILL.md'), content);
            const meta = parseSkillMd(content);
            const skill: Skill = {
                name: meta.name || name,
                description: meta.description || '',
                version: meta.version || '1.0.0',
                author: meta.author || 'Unknown',
                source: url,
                installed: new Date().toISOString(),
                path: skillDir,
                type: 'imported',
                tags: meta.tags || [],
            };
            writeFileSync(join(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
            return skill;
        }
    } catch { }

    return null;
}

function importFromLocal(path: string): Skill | null {
    const name = basename(path).replace(/\.(md|tar\.gz|zip)$/, '');
    const skillDir = join(SKILLS_DIR, name);
    mkdirSync(skillDir, { recursive: true });

    if (statSync(path).isDirectory()) {
        execSync(`cp -r "${path}"/* "${skillDir}/" 2>/dev/null`);
    } else {
        execSync(`cp "${path}" "${skillDir}/SKILL.md" 2>/dev/null`);
    }

    const skillFile = join(skillDir, 'SKILL.md');
    if (existsSync(skillFile)) {
        const meta = parseSkillMd(readFileSync(skillFile, 'utf-8'));
        const skill: Skill = {
            name: meta.name || name,
            description: meta.description || '',
            version: meta.version || '1.0.0',
            author: meta.author || 'Local',
            source: `local:${path}`,
            installed: new Date().toISOString(),
            path: skillDir,
            type: 'custom',
            tags: meta.tags || [],
        };
        writeFileSync(join(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
        return skill;
    }

    return null;
}

// ─── Helpers ────────────────────────────────────────────────────

function parseSkillMd(content: string): Record<string, any> {
    const meta: Record<string, any> = {};

    // Parse YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const lines = fmMatch[1].split('\n');
        for (const line of lines) {
            const [key, ...vals] = line.split(':');
            if (key && vals.length) {
                const value = vals.join(':').trim();
                meta[key.trim()] = value;
            }
        }
    }

    // Extract name from first heading if not in frontmatter
    if (!meta.name) {
        const h1 = content.match(/^#\s+(.+)/m);
        if (h1) meta.name = h1[1].trim();
    }

    // Extract description from first paragraph
    if (!meta.description) {
        const desc = content.match(/^(?!#)(.+)/m);
        if (desc) meta.description = desc[1].trim();
    }

    // Parse tags
    if (typeof meta.tags === 'string') {
        meta.tags = meta.tags.split(',').map((t: string) => t.trim());
    }

    return meta;
}

function extractSkillName(url: string): string {
    // github.com/user/repo -> repo
    // github.com/user/repo/tree/main/skills/name -> name
    const parts = url.replace(/\/$/, '').split('/');
    const treeIdx = parts.indexOf('tree');
    if (treeIdx > -1 && parts.length > treeIdx + 2) {
        return parts[parts.length - 1];
    }
    return parts[parts.length - 1].replace(/\.git$/, '');
}

function convertToRawUrl(url: string): string {
    // Convert GitHub URLs to raw content URLs
    return url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/tree/', '/')
        .replace('/blob/', '/');
}

export function scanSkill(path: string): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (!existsSync(path)) {
        return { safe: false, warnings: ['File not found'] };
    }

    const content = readFileSync(path, 'utf-8');

    // Check for dangerous patterns
    const dangerous = [
        { pattern: /rm\s+-rf\s+\//, msg: 'Destructive file deletion' },
        { pattern: /curl.*\|\s*(bash|sh)/, msg: 'Remote code execution' },
        { pattern: /eval\s*\(/, msg: 'Dynamic code evaluation' },
        { pattern: /process\.env\.(API_KEY|SECRET|PASSWORD|TOKEN)/, msg: 'Accesses sensitive env vars' },
        { pattern: /child_process|execSync|spawn/, msg: 'Executes system commands' },
        { pattern: /fs\.(unlink|rmdir|rm)/, msg: 'File deletion operations' },
        { pattern: /fetch\(.*\.exe\b/, msg: 'Downloads executables' },
    ];

    for (const { pattern, msg } of dangerous) {
        if (pattern.test(content)) {
            warnings.push(`⚠️ ${msg}`);
        }
    }

    return { safe: warnings.length === 0, warnings };
}
