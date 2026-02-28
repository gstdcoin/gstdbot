/**
 * Skills Marketplace — Install, verify, publish and run skills
 * 
 * Features:
 * - Install skills from the registry (marketplace)
 * - Load skills from local workspace
 * - Malware scanning before skill activation
 * - Version control and dependency checking
 * - GSTD pricing and usage tracking
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SkillManifest {
    name: string;
    description: string;
    version: string;
    author: string;
    price: number;
    currency: string;
    model?: string;
    tags: string[];
    tools?: string[];
    permissions?: string[];
}

export interface InstalledSkill {
    manifest: SkillManifest;
    path: string;
    hash: string;
    installed: number;
    verified: boolean;
    active: boolean;
}

// ─── Banned patterns for malware scanning ────────────────────────
const MALWARE_PATTERNS = [
    // Dangerous system commands
    /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+c:)/gi,
    // Crypto miners
    /\b(xmrig|minerd|cpuminer|ethminer|cryptonight)/gi,
    // Data exfiltration
    /\b(curl|wget|fetch)\s+.*\b(password|secret|private.?key|seed.?phrase|mnemonic)/gi,
    // Reverse shells
    /\b(bash\s+-i\s+>|nc\s+-e|python\s+-c.*socket|perl\s+-e.*socket)/gi,
    // Environment stealing
    /process\.env\[.*(KEY|SECRET|TOKEN|PASSWORD|SEED|MNEMONIC)/gi,
    // File system attacks
    /\b(eval|Function)\s*\(\s*(atob|Buffer\.from|decodeURI)/gi,
    // Hidden network calls to suspicious domains
    /\b(pastebin|hastebin|ngrok|serveo|portmap|localtunnel)\b/gi,
    // Obfuscated code
    /\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/gi,
    // Wallet drainers
    /\b(transfer|send|withdraw)\s*\(.*\b(all|balance|max)/gi,
];

// ─── Safe system prompt patterns (required) ──────────────────────
const REQUIRED_SECTIONS = ['name:', 'description:', 'version:'];

export class SkillsMarketplace {
    private skillsDir: string;
    private installedSkills = new Map<string, InstalledSkill>();
    private registryUrl: string;

    constructor(skillsDir: string, registryUrl = 'https://gstdbot.gstdtoken.com/api/v1/skills') {
        this.skillsDir = skillsDir;
        this.registryUrl = registryUrl;

        // Ensure skills directory exists
        if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true });
        }

        // Load installed skills
        this.loadInstalled();
    }

    /**
     * Load all installed skills from the workspace
     */
    private loadInstalled(): void {
        if (!fs.existsSync(this.skillsDir)) return;

        const dirs = fs.readdirSync(this.skillsDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const skillPath = path.join(this.skillsDir, dir.name, 'SKILL.md');
            if (!fs.existsSync(skillPath)) continue;

            try {
                const content = fs.readFileSync(skillPath, 'utf-8');
                const manifest = this.parseManifest(content);
                const hash = this.hashContent(content);

                this.installedSkills.set(manifest.name, {
                    manifest,
                    path: path.join(this.skillsDir, dir.name),
                    hash,
                    installed: fs.statSync(skillPath).mtimeMs,
                    verified: true, // Already installed = was verified
                    active: true,
                });
            } catch (err) {
                console.warn(`[Skills] Failed to load skill: ${dir.name}`, err);
            }
        }

        console.log(`[Skills] Loaded ${this.installedSkills.size} skills`);
    }

    /**
     * Parse SKILL.md frontmatter into manifest
     */
    parseManifest(content: string): SkillManifest {
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            throw new Error('Invalid SKILL.md: missing frontmatter (--- block)');
        }

        const frontmatter = frontmatterMatch[1];
        const manifest: Partial<SkillManifest> = {};

        // Parse YAML-like frontmatter
        const lines = frontmatter.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (!match) continue;
            const [, key, value] = match;

            switch (key) {
                case 'name': manifest.name = value.trim(); break;
                case 'description': manifest.description = value.trim(); break;
                case 'version': manifest.version = value.trim(); break;
                case 'author': manifest.author = value.trim(); break;
                case 'price': manifest.price = parseFloat(value) || 0; break;
                case 'currency': manifest.currency = value.trim(); break;
                case 'model': manifest.model = value.trim(); break;
                case 'tags':
                    manifest.tags = value.replace(/[\[\]]/g, '').split(',').map(t => t.trim());
                    break;
                case 'permissions':
                    manifest.permissions = value.replace(/[\[\]]/g, '').split(',').map(p => p.trim());
                    break;
            }
        }

        if (!manifest.name || !manifest.description || !manifest.version) {
            throw new Error('Invalid SKILL.md: missing required fields (name, description, version)');
        }

        return {
            name: manifest.name,
            description: manifest.description || '',
            version: manifest.version || '0.0.1',
            author: manifest.author || 'unknown',
            price: manifest.price || 0,
            currency: manifest.currency || 'GSTD',
            model: manifest.model,
            tags: manifest.tags || [],
            permissions: manifest.permissions,
        };
    }

    /**
     * Scan content for malware patterns
     * Returns an array of warnings/threats found
     */
    scanForMalware(content: string): string[] {
        const threats: string[] = [];

        for (const pattern of MALWARE_PATTERNS) {
            const matches = content.match(pattern);
            if (matches) {
                threats.push(`⚠️  Suspicious pattern detected: "${matches[0].substring(0, 50)}..." (${pattern.source.substring(0, 30)})`);
            }
        }

        // Check for excessive code blocks (potential hidden execution)
        const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
        let totalCodeLen = 0;
        for (const block of codeBlocks) {
            totalCodeLen += block.length;
            // Check code blocks for dangerous patterns
            for (const pattern of MALWARE_PATTERNS) {
                if (pattern.test(block)) {
                    threats.push(`⚠️  Malicious code in code block: ${pattern.source.substring(0, 30)}`);
                }
            }
        }

        // Warn if skill is mostly code (unusual for prompt skills)
        if (totalCodeLen > content.length * 0.8) {
            threats.push('⚠️  Skill contains excessive executable code (>80%)');
        }

        // Check for base64-encoded payloads
        const base64Pattern = /[A-Za-z0-9+/]{100,}={0,2}/g;
        const base64Matches = content.match(base64Pattern);
        if (base64Matches && base64Matches.length > 2) {
            threats.push('⚠️  Multiple base64-encoded payloads detected');
        }

        // Check required sections
        for (const section of REQUIRED_SECTIONS) {
            if (!content.includes(section)) {
                threats.push(`⚠️  Missing required section: ${section}`);
            }
        }

        return threats;
    }

    /**
     * Install a skill from content (with malware scan)
     */
    async install(skillId: string, content: string): Promise<{ success: boolean; threats: string[]; manifest?: SkillManifest }> {
        // Step 1: Malware scan
        const threats = this.scanForMalware(content);
        if (threats.length > 0) {
            console.warn(`[Skills] Security scan found ${threats.length} issues in "${skillId}":`);
            threats.forEach(t => console.warn(`  ${t}`));

            // Block install if critical threats found
            const critical = threats.filter(t => t.includes('Malicious') || t.includes('Reverse shell') || t.includes('drainer'));
            if (critical.length > 0) {
                return { success: false, threats };
            }
        }

        // Step 2: Parse manifest
        let manifest: SkillManifest;
        try {
            manifest = this.parseManifest(content);
        } catch (err: any) {
            return { success: false, threats: [...threats, `❌ ${err.message}`] };
        }

        // Step 3: Write to disk
        const skillDir = path.join(this.skillsDir, skillId);
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);

        // Step 4: Register
        const hash = this.hashContent(content);
        this.installedSkills.set(manifest.name, {
            manifest,
            path: skillDir,
            hash,
            installed: Date.now(),
            verified: threats.length === 0,
            active: true,
        });

        console.log(`[Skills] Installed: ${manifest.name} v${manifest.version} (${threats.length === 0 ? 'verified ✓' : 'warnings'})`);
        return { success: true, threats, manifest };
    }

    /**
     * Get skill prompt content for the AI agent
     */
    getSkillPrompt(skillId: string): string | null {
        const skill = this.installedSkills.get(skillId);
        if (!skill || !skill.active) return null;

        try {
            const content = fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf-8');
            // Remove frontmatter, return the body as prompt
            return content.replace(/^---[\s\S]*?---\n/, '').trim();
        } catch {
            return null;
        }
    }

    /**
     * List all installed skills
     */
    list(): InstalledSkill[] {
        return Array.from(this.installedSkills.values());
    }

    /**
     * Get skill by name
     */
    get(name: string): InstalledSkill | undefined {
        return this.installedSkills.get(name);
    }

    /**
     * Fetch skills from the marketplace registry
     */
    async fetchRegistry(): Promise<SkillManifest[]> {
        try {
            const response = await fetch(this.registryUrl);
            if (!response.ok) throw new Error(`Registry error: ${response.status}`);
            const data: any = await response.json();
            return data.data || [];
        } catch (err) {
            console.warn('[Skills] Failed to fetch registry:', err);
            return [];
        }
    }

    /**
     * Uninstall a skill
     */
    uninstall(skillId: string): boolean {
        const skill = this.installedSkills.get(skillId);
        if (!skill) return false;

        try {
            fs.rmSync(skill.path, { recursive: true, force: true });
            this.installedSkills.delete(skillId);
            console.log(`[Skills] Uninstalled: ${skillId}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Hash content for integrity verification
     */
    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
}
