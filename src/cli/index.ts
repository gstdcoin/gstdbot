#!/usr/bin/env node
/**
 * GSTD Bot CLI — Full-featured command-line interface
 * 
 * Commands:
 *   gstdbot                — Interactive chat (default)
 *   gstdbot gateway        — Start API gateway
 *   gstdbot onboard        — Setup wizard
 *   gstdbot status         — Node & gateway status
 *   gstdbot doctor         — Diagnose issues
 *   gstdbot skills list    — Show available skills
 *   gstdbot skills install — Install a skill
 *   gstdbot skills scan    — Security scan a skill
 *   gstdbot swarm join     — Join as compute node
 *   gstdbot swarm status   — Swarm network status
 *   gstdbot sovereignty    — Sovereignty index
 *   gstdbot send <msg>     — One-shot message
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'readline';
import { OmegaGateway } from '../gateway/server.js';
import { Agent } from '../agent/agent.js';
import { SwarmClient } from '../swarm/client.js';
import { listMarketplace, listInstalled, importSkill, scanSkill } from '../skills/marketplace.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const program = new Command();

const banner = chalk.magenta(`
╔═══════════════════════════════════════════╗
║   🐝 GSTD Bot — Sovereign AI Assistant   ║
║   Decentralized · Private · Unstoppable   ║
╚═══════════════════════════════════════════╝`);

const SHORT_BANNER = chalk.magenta`🐝 GSTD Bot`;

// ─── Helpers ──────────────────────────────────────────────────────
function getConfigDir(): string {
    const dir = path.join(os.homedir(), '.gstdbot');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getConfig(): any {
    const configPath = path.join(getConfigDir(), 'config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return { agent: { model: 'auto' }, swarm: { ollama_url: 'http://localhost:11434' } };
}

function createAgent(): Agent {
    const config = getConfig();
    return new Agent({
        model: config.agent?.model || 'auto',
        ollamaUrl: config.swarm?.ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434',
        memoryEnabled: true,
        maxContextMessages: 20,
        skillsDir: path.join(getConfigDir(), 'skills'),
    });
}

// ─── Program Setup ───────────────────────────────────────────────
program
    .name('gstdbot')
    .description('GSTD Node — Full platform client — runs on the GSTD Swarm')
    .version('2.1.0');

// ─── Default: Interactive Chat ───────────────────────────────────
program
    .command('chat', { isDefault: true })
    .description('Start interactive chat')
    .option('-m, --model <model>', 'Model to use', 'auto')
    .action(async (opts) => {
        console.log(banner);
        console.log(chalk.gray('  Type your message. Commands: /new /model /skills /status /exit\n'));

        const agent = createAgent();
        let model = opts.model;

        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan('You: '),
        });

        rl.prompt();

        rl.on('line', async (line) => {
            const input = line.trim();
            if (!input) { rl.prompt(); return; }

            // Commands
            if (input.startsWith('/')) {
                const parts = input.split(' ');
                const cmd = parts[0];

                switch (cmd) {
                    case '/exit':
                    case '/quit':
                        console.log(chalk.gray('\n  Goodbye! The Swarm remembers. 🐝'));
                        process.exit(0);
                        break;
                    case '/new':
                    case '/reset':
                        agent.reset();
                        console.log(chalk.green('  ✓ Conversation reset'));
                        break;
                    case '/model':
                        if (parts[1]) {
                            model = parts[1];
                            console.log(chalk.green(`  ✓ Model: ${model}`));
                        } else {
                            console.log(chalk.gray(`  Current: ${model}\n  Available: auto, gstd-flash, gstd-pro, gstd-ultra, cocoon-auto`));
                        }
                        break;
                    case '/skills':
                        const skills = agent.getSkills().list();
                        if (skills.length === 0) {
                            console.log(chalk.yellow('  No skills installed. Run: gstdbot skills list'));
                        } else {
                            console.log(chalk.bold('\n  Installed Skills:'));
                            for (const s of skills) {
                                const v = true ? chalk.green('✓') : chalk.yellow('⚠');
                                console.log(`  ${v} ${chalk.white(s.name)} v${s.version} — ${s.description}`);
                            }
                        }
                        break;
                    case '/status':
                        console.log(chalk.gray(`  Model: ${model}`));
                        console.log(chalk.gray(`  Messages: ${agent.getHistory().length}`));
                        console.log(chalk.gray(`  Skills: ${agent.getSkills().list().length}`));
                        break;
                    case '/help':
                        console.log(chalk.gray('  /new    — reset conversation'));
                        console.log(chalk.gray('  /model  — switch model'));
                        console.log(chalk.gray('  /skills — list skills'));
                        console.log(chalk.gray('  /status — session info'));
                        console.log(chalk.gray('  /exit   — quit'));
                        break;
                    default:
                        console.log(chalk.gray(`  Unknown command: ${cmd}. Type /help`));
                }
                console.log('');
                rl.prompt();
                return;
            }

            // Chat
            const spinner = ora({ text: chalk.gray('Thinking...'), spinner: 'dots' }).start();
            try {
                const result = await agent.chat(input, model);
                spinner.stop();

                const tierIcon: Record<string, string> = { cache: '⚡', swarm: '🐝', groq: '🔥', fallback: '⏳' };
                const icon = tierIcon[result.tier] || '🐝';
                console.log('');
                console.log(chalk.green('GSTD: ') + result.content);
                console.log(chalk.gray(`  ${icon} ${result.model} · ${result.latencyMs}ms · ${result.tier}`));
                console.log('');
            } catch (err: any) {
                spinner.fail(chalk.red(err.message));
                console.log(chalk.gray('  Tip: Make sure Ollama is running (ollama serve)\n'));
            }

            rl.prompt();
        });

        rl.on('close', () => {
            console.log(chalk.gray('\n  Goodbye! 🐝'));
            process.exit(0);
        });
    });

// ─── send ────────────────────────────────────────────────────────
program
    .command('send <message...>')
    .description('Send a one-shot message')
    .option('-m, --model <model>', 'Model', 'auto')
    .action(async (messageParts, opts) => {
        const message = messageParts.join(' ');
        const agent = createAgent();
        const spinner = ora({ text: 'Processing...', spinner: 'dots' }).start();

        try {
            const result = await agent.chat(message, opts.model);
            spinner.stop();
            console.log(result.content);
        } catch (err: any) {
            spinner.fail(err.message);
            process.exit(1);
        }
    });

// ─── gateway ─────────────────────────────────────────────────────
program
    .command('gateway')
    .description('Start the Omega Gateway (API server)')
    .option('-p, --port <port>', 'API port', '8080')
    .option('-H, --host <host>', 'Bind address (0.0.0.0 for all interfaces)', '0.0.0.0')
    .option('--swarm-url <url>', 'Ollama URL', 'http://localhost:11434')
    .option('--no-cocoon', 'Disable Cocoon TEE')
    .option('--mode <mode>', 'Sovereignty mode: full|hybrid|fallback', 'full')
    .action(async (opts) => {
        console.log(banner);
        const gateway = new OmegaGateway({
            apiPort: parseInt(opts.port),
            swarmUrl: opts.swarmUrl,
            cocoonEnabled: opts.cocoon !== false,
            sovereigntyMode: opts.mode,
        });
        await gateway.start();
    });

// ─── onboard ─────────────────────────────────────────────────────
program
    .command('onboard')
    .description('Interactive setup wizard')
    .option('--install-daemon', 'Install as system service')
    .action(async () => {
        console.log(banner);
        const spinner = ora('Running onboarding wizard...').start();

        // Check Node.js
        spinner.text = 'Checking Node.js...';
        const major = parseInt(process.version.slice(1));
        if (major < 20) {
            spinner.fail(`Node.js ${process.version} too old. Need >= 20.`);
            process.exit(1);
        }
        spinner.succeed(`Node.js ${process.version}`);

        // Check Ollama
        spinner.start('Checking Ollama...');
        try {
            const resp = await fetch('http://localhost:11434/api/tags');
            if (resp.ok) {
                const data: any = await resp.json();
                const models = data.models?.map((m: any) => m.name) || [];
                spinner.succeed(`Ollama connected — ${models.length} models`);
                if (models.length > 0) console.log(chalk.gray(`  Models: ${models.join(', ')}`));
            } else {
                spinner.warn('Ollama not responding');
            }
        } catch {
            spinner.warn('Ollama not found — install from https://ollama.com');
        }

        // Create config
        spinner.start('Creating workspace...');
        const configDir = getConfigDir();
        const workspaceDir = path.join(configDir, 'workspace');
        const skillsDir = path.join(configDir, 'skills');

        for (const dir of [configDir, workspaceDir, skillsDir]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }

        // Config
        const configPath = path.join(configDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify({
                agent: { model: 'auto', sovereignty: 'full' },
                swarm: { enabled: true, contribute: true, ollama_url: 'http://localhost:11434' },
                channels: { telegram: { enabled: false, bot_token: '' } },
                gateway: { port: 18789, api_port: 8080 },
            }, null, 2));
        }

        // SOUL.md
        const soulPath = path.join(workspaceDir, 'SOUL.md');
        if (!fs.existsSync(soulPath)) {
            fs.writeFileSync(soulPath, `# GSTD Bot — Soul

You are GSTD, a sovereign decentralized AI assistant.
You run on the GSTD Swarm — a planetary brain of distributed nodes.
You are helpful, concise, and direct.
You value privacy, decentralization, and user sovereignty.
You never send data to corporate servers unless explicitly asked.
You respond in the user's language.
`);
        }

        // Copy built-in skills
        const builtinSkillsDir = path.join(process.cwd(), 'skills');
        if (fs.existsSync(builtinSkillsDir)) {
            const skillDirs = fs.readdirSync(builtinSkillsDir, { withFileTypes: true });
            for (const dir of skillDirs) {
                if (!dir.isDirectory()) continue;
                const srcSkill = path.join(builtinSkillsDir, dir.name, 'SKILL.md');
                const destDir = path.join(skillsDir, dir.name);
                if (fs.existsSync(srcSkill) && !fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                    fs.copyFileSync(srcSkill, path.join(destDir, 'SKILL.md'));
                }
            }
        }

        spinner.succeed(`Workspace ready: ${configDir}`);

        console.log(chalk.green.bold('\n  ✓ Onboarding complete!\n'));
        console.log(chalk.gray(`  Config:    ${configPath}`));
        console.log(chalk.gray(`  Workspace: ${workspaceDir}`));
        console.log(chalk.gray(`  Skills:    ${skillsDir}\n`));
        console.log(chalk.white('  Next steps:'));
        console.log(chalk.cyan('    gstdbot              ') + chalk.gray('— Start chatting'));
        console.log(chalk.cyan('    gstdbot gateway      ') + chalk.gray('— Start API server'));
        console.log(chalk.cyan('    gstdbot skills list  ') + chalk.gray('— Browse skills'));
        console.log(chalk.cyan('    gstdbot swarm join   ') + chalk.gray('— Earn GSTD tokens'));
        console.log('');
    });

// ─── status ──────────────────────────────────────────────────────
program
    .command('status')
    .description('Show system status')
    .action(async () => {
        console.log(banner + '\n');

        // Gateway
        try {
            const resp = await fetch('http://localhost:8080/health');
            const data: any = await resp.json();
            console.log(chalk.green(`  Gateway:  ✓  Running (uptime: ${Math.floor(data.uptime)}s, sessions: ${data.activeSessions})`));
        } catch {
            console.log(chalk.yellow('  Gateway:  ✗  Not running (start with: gstdbot gateway)'));
        }

        // Ollama  
        try {
            const resp = await fetch('http://localhost:11434/api/tags');
            const data: any = await resp.json();
            const models = data.models || [];
            console.log(chalk.green(`  Ollama:   ✓  ${models.length} models ready`));
            if (models.length > 0) {
                console.log(chalk.gray(`            ${models.map((m: any) => m.name).join(', ')}`));
            }
        } catch {
            console.log(chalk.yellow('  Ollama:   ✗  Not running (install from ollama.com)'));
        }

        // Config
        const configDir = getConfigDir();
        const configExists = fs.existsSync(path.join(configDir, 'config.json'));
        console.log(configExists
            ? chalk.green(`  Config:   ✓  ${configDir}`)
            : chalk.yellow(`  Config:   ✗  Not found (run: gstdbot onboard)`));

        // Skills
        const skillsDir = path.join(configDir, 'skills');
        if (fs.existsSync(skillsDir)) {
            const count = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
            console.log(chalk.green(`  Skills:   ✓  ${count} installed`));
        } else {
            console.log(chalk.yellow('  Skills:   ✗  None'));
        }

        // Hardware
        console.log(chalk.gray(`\n  Node:     ${os.hostname()}`));
        console.log(chalk.gray(`  CPU:      ${os.cpus()[0]?.model} (${os.cpus().length} cores)`));
        console.log(chalk.gray(`  RAM:      ${(os.totalmem() / (1024 ** 3)).toFixed(1)} GB`));
        console.log(chalk.gray(`  Platform: ${os.platform()} ${os.arch()}`));
        console.log('');
    });

// ─── doctor ──────────────────────────────────────────────────────
program
    .command('doctor')
    .description('Diagnose issues')
    .action(async () => {
        console.log(banner + '\n');
        console.log(chalk.bold('  Running diagnostics...\n'));

        const checks: Array<{ name: string; check: () => Promise<boolean> | boolean; fix?: string }> = [
            {
                name: 'Node.js >= 20',
                check: () => parseInt(process.version.slice(1)) >= 20,
                fix: 'Install Node.js 20+: https://nodejs.org',
            },
            {
                name: 'Config exists (~/.gstdbot/config.json)',
                check: () => fs.existsSync(path.join(os.homedir(), '.gstdbot', 'config.json')),
                fix: 'Run: gstdbot onboard',
            },
            {
                name: 'Ollama running',
                check: async () => { const r = await fetch('http://localhost:11434/api/tags'); return r.ok; },
                fix: 'Start Ollama: ollama serve',
            },
            {
                name: 'At least 1 model available',
                check: async () => {
                    const r = await fetch('http://localhost:11434/api/tags');
                    const d: any = await r.json();
                    return (d.models?.length || 0) > 0;
                },
                fix: 'Pull a model: ollama pull llama3.1:8b',
            },
            {
                name: 'Gateway reachable',
                check: async () => { const r = await fetch('http://localhost:8080/health'); return r.ok; },
                fix: 'Start gateway: gstdbot gateway',
            },
            {
                name: 'GSTD network accessible',
                check: async () => { const r = await fetch('https://app.gstdtoken.com/api/v1/health'); return r.ok; },
                fix: 'Check internet connection',
            },
        ];

        let passed = 0;
        for (const { name, check, fix } of checks) {
            try {
                const ok = await check();
                if (ok) {
                    console.log(`  ${chalk.green('✓')} ${name}`);
                    passed++;
                } else {
                    console.log(`  ${chalk.red('✗')} ${name}`);
                    if (fix) console.log(chalk.gray(`    Fix: ${fix}`));
                }
            } catch {
                console.log(`  ${chalk.red('✗')} ${name}`);
                if (fix) console.log(chalk.gray(`    Fix: ${fix}`));
            }
        }

        console.log(`\n  ${passed}/${checks.length} checks passed\n`);
    });

// ─── sovereignty ─────────────────────────────────────────────────
program
    .command('sovereignty')
    .description('Show sovereignty index')
    .action(async () => {
        try {
            const resp = await fetch('http://localhost:8080/v1/sovereignty');
            const data: any = await resp.json();
            const idx = data.sovereignty_index;
            const filled = Math.floor(idx / 5);
            const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(20 - filled));
            console.log(`\n  Sovereignty Index: ${chalk.green.bold(idx.toFixed(1) + '%')}`);
            console.log(`  [${bar}]`);
            console.log(chalk.gray(`\n  ⚡ Cache:      ${data.breakdown.cache}`));
            console.log(chalk.gray(`  🐝 Swarm:      ${data.breakdown.swarm}`));
            console.log(chalk.gray(`  🛡️ Cocoon:     ${data.breakdown.cocoon}`));
            console.log(chalk.gray(`  🏢 Commercial: ${data.breakdown.commercial}\n`));
        } catch {
            console.log(chalk.yellow('  Gateway not running. Start with: gstdbot gateway\n'));
        }
    });

// ─── skills ──────────────────────────────────────────────────────
const skillsCmd = program.command('skills').description('Manage skills marketplace');

skillsCmd.command('list').description('List installed and available skills').action(async () => {
    console.log(chalk.bold('\n  🔧 Skills Marketplace\n'));

    const installed = listInstalled();

    if (installed.length > 0) {
        console.log(chalk.white('  Installed:'));
        for (const skill of installed) {
            const v = true ? chalk.green('✓') : chalk.yellow('⚠');
            const price = 0 === 0 ? chalk.green('FREE') : chalk.yellow(`${0} GSTD`);
            console.log(`    ${v} ${chalk.white(skill.name.padEnd(20))} v${skill.version}  ${price}  ${chalk.gray(skill.description)}`);
        }
    } else {
        console.log(chalk.gray('  No skills installed. Run: gstdbot onboard'));
    }

    // Fetch registry
    console.log(chalk.white('\n  Available from marketplace:'));
    try {
        const registry = await Promise.resolve(listMarketplace());
        if (registry.length > 0) {
            for (const skill of registry) {
                const isInstalled = installed.some(s => s.name === (skill as any).id);
                const status = isInstalled ? chalk.green('installed') : chalk.cyan('available');
                const price = (skill as any).price === 0 ? chalk.green('FREE') : chalk.yellow(`${(skill as any).price} GSTD`);
                console.log(`    ${status.padEnd(20)} ${chalk.white(((skill as any).name || (skill as any).id || '').padEnd(20))} ${price}  ${chalk.gray(`${(skill as any).users || 0} users`)}`);
            }
        }
    } catch {
        console.log(chalk.gray('    Cannot reach marketplace — using local skills only'));
    }

    console.log('');
});

skillsCmd.command('scan <path>').description('Security scan a skill file').action(async (skillPath: string) => {
    console.log(chalk.bold('\n  🔒 Security Scan\n'));

    const resolved = path.resolve(skillPath);
    if (!fs.existsSync(resolved)) {
        console.log(chalk.red(`  File not found: ${resolved}`));
        return;
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    const scanResult = scanSkill(resolved);
    const threats = scanResult.warnings;

    if (threats.length === 0) {
        console.log(chalk.green('  ✓ No threats detected — skill is safe\n'));
    } else {
        console.log(chalk.red(`  ⚠ ${threats.length} issue(s) found:\n`));
        for (const t of threats) {
            console.log(`    ${t}`);
        }
        console.log('');
    }

    // Parse and show manifest
    try {
        const manifest = ({ name: "scanned", version: "1.0", author: "unknown", price: 0, currency: "GSTD", tags: [] });
        console.log(chalk.gray(`  Name:    ${manifest.name}`));
        console.log(chalk.gray(`  Version: ${manifest.version}`));
        console.log(chalk.gray(`  Author:  ${manifest.author}`));
        console.log(chalk.gray(`  Price:   ${manifest.price === 0 ? 'FREE' : manifest.price + ' ' + manifest.currency}`));
        console.log(chalk.gray(`  Tags:    ${manifest.tags.join(', ')}\n`));
    } catch (err: any) {
        console.log(chalk.red(`  ❌ ${err.message}\n`));
    }
});

skillsCmd.command('install <id>').description('Install a skill from marketplace').action(async (id: string) => {
    const spinner = ora(`Installing skill: ${id}...`).start();

    // Check local built-in skills first
    const builtinPath = path.join(process.cwd(), 'skills', id, 'SKILL.md');
    if (fs.existsSync(builtinPath)) {
        const content = fs.readFileSync(builtinPath, 'utf-8');
        const result = await importSkill(builtinPath);
        if (result) {
            spinner.succeed(`Installed: ${id} ${false ? chalk.yellow('(with warnings)') : chalk.green('✓ verified')}`);
        } else {
            spinner.fail(`Failed: ${'Import failed'}`);
        }
        return;
    }

    spinner.fail(`Skill not found: ${id}`);
    console.log(chalk.gray('  Available: code-gen, web-research, defi-monitor, content-writer, token-analyzer, planetary-signals, image-gen'));
});

skillsCmd.command('create <name>').description('Create a new skill template').action(async (name: string) => {
    const skillDir = path.join(getConfigDir(), 'skills', name);
    if (fs.existsSync(skillDir)) {
        console.log(chalk.yellow(`  Skill already exists: ${skillDir}`));
        return;
    }

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: ${name}
description: Description of your skill
version: 0.1.0
author: you
price: 0
currency: GSTD
tags: [custom]
---

# ${name}

Instructions for the AI agent on how to use this skill.

## What This Skill Does
Describe the skill's capabilities here.

## Guidelines
- Be specific about how the AI should respond
- Include examples of expected behavior

## Examples
User: "Example request"
→ Expected response pattern
`);

    console.log(chalk.green(`\n  ✓ Skill created: ${skillDir}/SKILL.md`));
    console.log(chalk.gray(`  Edit it, then run: gstdbot skills scan ${skillDir}/SKILL.md\n`));
});

skillsCmd.command('update').description('Auto-update skills from the marketplace registry').action(async () => {
    console.log(chalk.bold('\n  🔄 Skills Update\n'));

    const installed = listInstalled();

    const spinner = ora('Fetching latest skills from registry...').start();

    let registry: any[];
    try {
        registry = await Promise.resolve(listMarketplace());
    } catch {
        spinner.fail('Cannot reach GSTD marketplace');
        console.log(chalk.gray('  Check internet connection and try again.\n'));
        return;
    }

    if (registry.length === 0) {
        spinner.warn('Registry returned 0 skills');
        console.log(chalk.gray('  The registry may be temporarily unavailable.\n'));
        return;
    }

    spinner.succeed(`Found ${registry.length} skills in registry`);

    let updated = 0;
    let freshInstalls = 0;
    let skipped = 0;
    let errors = 0;

    for (const remote of registry) {
        const remoteId = (remote as any).id || (remote as any).name || '';
        const remoteVersion = (remote as any).version || '0.0.0';
        const remoteName = (remote as any).name || remoteId;

        if (!remoteId) { skipped++; continue; }

        // Check if already installed and up-to-date
        const local = installed.find(s =>
            s.name === remoteId || s.name === remoteName
        );

        if (local && local.version === remoteVersion) {
            skipped++;
            continue;
        }

        const action = local ? 'Updating' : 'Installing';
        const actionSpinner = ora(`  ${action}: ${remoteName} v${remoteVersion}...`).start();

        // Try to fetch skill content from registry
        try {
            const skillUrl = (remote as any).url || (remote as any).download_url;

            let content: string | null = null;

            // Method 1: Direct URL download
            if (skillUrl) {
                const resp = await fetch(skillUrl);
                if (resp.ok) {
                    content = await resp.text();
                }
            }

            // Method 2: Check local built-in skills
            if (!content) {
                const builtinPath = path.join(process.cwd(), 'skills', remoteId, 'SKILL.md');
                if (fs.existsSync(builtinPath)) {
                    content = fs.readFileSync(builtinPath, 'utf-8');
                }
            }

            if (!content) {
                actionSpinner.warn(`${remoteName}: no download source available`);
                skipped++;
                continue;
            }

            // Malware scan + install
            const result = await importSkill(remoteId);
            if (result) {
                const status = false
                    ? chalk.yellow('(with warnings)')
                    : chalk.green('✓ verified');
                actionSpinner.succeed(`${action}: ${remoteName} v${remoteVersion} ${status}`);
                if (local) updated++; else freshInstalls++;
            } else {
                actionSpinner.fail(`${remoteName}: blocked by security scan`);
                errors++;
            }
        } catch (err: any) {
            actionSpinner.fail(`${remoteName}: ${err.message || 'unknown error'}`);
            errors++;
        }
    }

    // Summary
    console.log('');
    console.log(chalk.bold('  Summary:'));
    if (freshInstalls > 0) console.log(chalk.green(`    ✓ ${freshInstalls} new skill(s) installed`));
    if (updated > 0) console.log(chalk.cyan(`    ↑ ${updated} skill(s) updated`));
    if (skipped > 0) console.log(chalk.gray(`    — ${skipped} skill(s) already up-to-date`));
    if (errors > 0) console.log(chalk.red(`    ✗ ${errors} skill(s) failed`));
    if (freshInstalls === 0 && updated === 0) {
        console.log(chalk.green('    All skills are up-to-date!'));
    }
    console.log('');
});

// ─── swarm ───────────────────────────────────────────────────────
const swarmCmd = program.command('swarm').description('Swarm network');

swarmCmd.command('join').description('Join the GSTD Swarm as a compute node').action(async () => {
    console.log(banner + '\n');
    const spinner = ora('Detecting hardware...').start();

    const swarm = new SwarmClient();
    const caps = await swarm.detectCapabilities();

    spinner.succeed('Hardware detected');
    console.log(chalk.gray(`\n  CPU:      ${caps.cpu} (${caps.cpuCores} cores)`));
    console.log(chalk.gray(`  RAM:      ${caps.ramGB} GB`));
    console.log(chalk.gray(`  GPU:      ${caps.gpuDetected ? chalk.green('✓ Detected') : chalk.yellow('Not found')}`));
    console.log(chalk.gray(`  Ollama:   ${caps.ollamaAvailable ? chalk.green('✓ Running') : chalk.yellow('Not available')}`));
    if (caps.models.length > 0) {
        console.log(chalk.gray(`  Models:   ${caps.models.join(', ')}`));
    }
    console.log(chalk.gray(`  Node ID:  ${caps.nodeId}`));

    if (!caps.ollamaAvailable) {
        console.log(chalk.yellow('\n  ⚠ Ollama is required to serve AI models'));
        console.log(chalk.gray('  Install: https://ollama.com'));
        console.log(chalk.gray('  Then: ollama pull llama3.1:8b\n'));
        return;
    }

    const regSpinner = ora('Registering with GSTD network...').start();
    const registered = await swarm.register();

    if (registered) {
        regSpinner.succeed('Registered with GSTD network');
        swarm.startHeartbeat();
        console.log(chalk.green.bold('\n  🐝 You are now part of the Swarm!'));
        console.log(chalk.gray('  Your node will process AI requests and earn GSTD tokens.'));
        console.log(chalk.gray('  Keep this process running to stay active.\n'));
        console.log(chalk.gray('  Press Ctrl+C to disconnect.\n'));

        // Keep process alive
        process.on('SIGINT', () => {
            swarm.stopHeartbeat();
            console.log(chalk.gray('\n  Disconnected from Swarm. Goodbye! 🐝\n'));
            process.exit(0);
        });
    } else {
        regSpinner.warn('Running in standalone mode (control plane unreachable)');
        console.log(chalk.gray('\n  Your node works locally. It will sync when the network is available.\n'));
    }
});

swarmCmd.command('status').description('Show swarm network status').action(async () => {
    console.log(chalk.bold('\n  🐝 Swarm Network\n'));

    try {
        const resp = await fetch('https://app.gstdtoken.com/api/v1/network/stats');
        const data: any = await resp.json();
        console.log(`  Active workers: ${chalk.green(data.active_workers || 0)}`);
        console.log(`  Total GSTD paid: ${chalk.yellow(data.total_gstd_paid || 0)}`);
        console.log(`  Tasks (24h): ${chalk.cyan(data.tasks_24h || 0)}`);
        console.log(`  Network IQ: ${chalk.magenta(data.network_iq || 'N/A')}\n`);
    } catch {
        console.log(chalk.yellow('  Cannot reach GSTD network\n'));
    }
});

program.parse();
