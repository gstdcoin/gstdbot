"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSkillsDir = ensureSkillsDir;
exports.listInstalled = listInstalled;
exports.listMarketplace = listMarketplace;
exports.importSkill = importSkill;
exports.scanSkill = scanSkill;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const child_process_1 = require("child_process");
const SKILLS_DIR = (0, path_1.join)((0, os_1.homedir)(), '.config', 'gstdbot', 'skills');
const BUILTIN_DIR = (0, path_1.join)(__dirname, '..', '..', 'skills');
// ─── Marketplace catalog ────────────────────────────────────────
const MARKETPLACE = [
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
        tags: ['image', 'art'], gstdCost: 1
    },
    {
        id: 'defi-monitor', name: '📊 DeFi Monitor', description: 'Track DeFi positions, yield, and portfolio across chains',
        author: 'GSTD Core', downloads: 1340, stars: 38, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/defi-monitor',
        tags: ['defi', 'crypto'], gstdCost: 0
    },
    {
        id: 'token-analyzer', name: '🔬 Token Analyzer', description: 'On-chain analysis, whale tracking, smart money alerts',
        author: 'GSTD Core', downloads: 2100, stars: 56, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/token-analyzer',
        tags: ['crypto', 'analysis'], gstdCost: 0
    },
    {
        id: 'planetary-signals', name: '📡 Planetary Signals', description: 'Monitor and sponsor 29 planetary research signals',
        author: 'GSTD Core', downloads: 890, stars: 34, url: 'https://github.com/gstdcoin/gstdbot/tree/main/skills/planetary-signals',
        tags: ['science', 'climate'], gstdCost: 0
    },
    {
        id: 'smart-contract', name: '📝 Smart Contract Auditor', description: 'AI-powered Solidity/FunC audit with vulnerability detection',
        author: 'Community', downloads: 760, stars: 28, url: 'https://github.com/gstdcoin/skill-contract-audit',
        tags: ['security', 'blockchain'], gstdCost: 2
    },
    {
        id: 'voice-assistant', name: '🎙️ Voice Assistant', description: 'Speech-to-text + text-to-speech for hands-free AI',
        author: 'Community', downloads: 520, stars: 19, url: 'https://github.com/gstdcoin/skill-voice',
        tags: ['voice', 'accessibility'], gstdCost: 1
    },
    {
        id: 'data-analyst', name: '📈 Data Analyst', description: 'CSV/JSON analysis with charts, stats, and insights',
        author: 'Community', downloads: 1100, stars: 42, url: 'https://github.com/gstdcoin/skill-data-analyst',
        tags: ['data', 'analytics'], gstdCost: 0
    },
];
// ─── Core Functions ─────────────────────────────────────────────
function ensureSkillsDir() {
    if (!(0, fs_1.existsSync)(SKILLS_DIR)) {
        (0, fs_1.mkdirSync)(SKILLS_DIR, { recursive: true });
    }
}
function listInstalled() {
    ensureSkillsDir();
    const skills = [];
    // Built-in skills
    if ((0, fs_1.existsSync)(BUILTIN_DIR)) {
        for (const name of (0, fs_1.readdirSync)(BUILTIN_DIR)) {
            const skillDir = (0, path_1.join)(BUILTIN_DIR, name);
            if ((0, fs_1.statSync)(skillDir).isDirectory()) {
                const skillFile = (0, path_1.join)(skillDir, 'SKILL.md');
                if ((0, fs_1.existsSync)(skillFile)) {
                    const meta = parseSkillMd((0, fs_1.readFileSync)(skillFile, 'utf-8'));
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
    for (const name of (0, fs_1.readdirSync)(SKILLS_DIR)) {
        const skillDir = (0, path_1.join)(SKILLS_DIR, name);
        if ((0, fs_1.statSync)(skillDir).isDirectory()) {
            const metaFile = (0, path_1.join)(skillDir, 'meta.json');
            if ((0, fs_1.existsSync)(metaFile)) {
                try {
                    const meta = JSON.parse((0, fs_1.readFileSync)(metaFile, 'utf-8'));
                    skills.push({ ...meta, path: skillDir });
                }
                catch (_e) { }
            }
        }
    }
    return skills;
}
function listMarketplace() {
    return MARKETPLACE;
}
async function importSkill(source) {
    ensureSkillsDir();
    // Detect source type
    if (source.startsWith('http://') || source.startsWith('https://')) {
        return importFromUrl(source);
    }
    else if (source.includes('/') && !source.startsWith('.')) {
        // Treat as GitHub shorthand: user/repo
        return importFromUrl(`https://github.com/${source}`);
    }
    else if ((0, fs_1.existsSync)(source)) {
        return importFromLocal(source);
    }
    else {
        // Try marketplace
        const mkt = MARKETPLACE.find(s => s.id === source);
        if (mkt) {
            return importFromUrl(mkt.url);
        }
        return null;
    }
}
async function importFromUrl(url) {
    const name = extractSkillName(url);
    const skillDir = (0, path_1.join)(SKILLS_DIR, name);
    if ((0, fs_1.existsSync)(skillDir)) {
        console.log(`  Skill "${name}" already installed, updating...`);
    }
    (0, fs_1.mkdirSync)(skillDir, { recursive: true });
    // If it's a GitHub repo URL
    if (url.includes('github.com')) {
        const rawUrl = convertToRawUrl(url);
        // Try to fetch SKILL.md directly
        try {
            const resp = await fetch(`${rawUrl}/SKILL.md`).catch(() => null);
            if (resp?.ok) {
                const content = await resp.text();
                (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'SKILL.md'), content);
                const meta = parseSkillMd(content);
                const skill = {
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
                (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
                return skill;
            }
        }
        catch (_e) { }
        // Try git clone
        try {
            const cloneUrl = url.replace(/\/tree\/.*/, '.git');
            (0, child_process_1.execSync)(`git clone --depth 1 ${cloneUrl} "${skillDir}" 2>/dev/null`, { timeout: 30000 });
            const skillFile = (0, path_1.join)(skillDir, 'SKILL.md');
            if ((0, fs_1.existsSync)(skillFile)) {
                const meta = parseSkillMd((0, fs_1.readFileSync)(skillFile, 'utf-8'));
                const skill = {
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
                (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
                return skill;
            }
        }
        catch (_e) { }
    }
    // Generic URL fetch (SKILL.md file)
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const content = await resp.text();
            (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'SKILL.md'), content);
            const meta = parseSkillMd(content);
            const skill = {
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
            (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
            return skill;
        }
    }
    catch (_e) { }
    return null;
}
function importFromLocal(path) {
    const name = (0, path_1.basename)(path).replace(/\.(md|tar\.gz|zip)$/, '');
    const skillDir = (0, path_1.join)(SKILLS_DIR, name);
    (0, fs_1.mkdirSync)(skillDir, { recursive: true });
    if ((0, fs_1.statSync)(path).isDirectory()) {
        (0, child_process_1.execSync)(`cp -r "${path}"/* "${skillDir}/" 2>/dev/null`);
    }
    else {
        (0, child_process_1.execSync)(`cp "${path}" "${skillDir}/SKILL.md" 2>/dev/null`);
    }
    const skillFile = (0, path_1.join)(skillDir, 'SKILL.md');
    if ((0, fs_1.existsSync)(skillFile)) {
        const meta = parseSkillMd((0, fs_1.readFileSync)(skillFile, 'utf-8'));
        const skill = {
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
        (0, fs_1.writeFileSync)((0, path_1.join)(skillDir, 'meta.json'), JSON.stringify(skill, null, 2));
        return skill;
    }
    return null;
}
// ─── Helpers ────────────────────────────────────────────────────
function parseSkillMd(content) {
    const meta = {};
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
        if (h1)
            meta.name = h1[1].trim();
    }
    // Extract description from first paragraph
    if (!meta.description) {
        const desc = content.match(/^(?!#)(.+)/m);
        if (desc)
            meta.description = desc[1].trim();
    }
    // Parse tags
    if (typeof meta.tags === 'string') {
        meta.tags = meta.tags.split(',').map((t) => t.trim());
    }
    return meta;
}
function extractSkillName(url) {
    // github.com/user/repo -> repo
    // github.com/user/repo/tree/main/skills/name -> name
    const parts = url.replace(/\/$/, '').split('/');
    const treeIdx = parts.indexOf('tree');
    if (treeIdx > -1 && parts.length > treeIdx + 2) {
        return parts[parts.length - 1];
    }
    return parts[parts.length - 1].replace(/\.git$/, '');
}
function convertToRawUrl(url) {
    // Convert GitHub URLs to raw content URLs
    return url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/tree/', '/')
        .replace('/blob/', '/');
}
function scanSkill(path) {
    const warnings = [];
    if (!(0, fs_1.existsSync)(path)) {
        return { safe: false, warnings: ['File not found'] };
    }
    const content = (0, fs_1.readFileSync)(path, 'utf-8');
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
//# sourceMappingURL=marketplace.js.map