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
    gstdCost: number;
}
export declare function ensureSkillsDir(): void;
export declare function listInstalled(): Skill[];
export declare function listMarketplace(): MarketplaceSkill[];
export declare function importSkill(source: string): Promise<Skill | null>;
export declare function scanSkill(path: string): {
    safe: boolean;
    warnings: string[];
};
//# sourceMappingURL=marketplace.d.ts.map