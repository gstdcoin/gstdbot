#!/usr/bin/env node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const readline_1 = require("readline");
const server_js_1 = require("../gateway/server.js");
const agent_js_1 = require("../agent/agent.js");
const client_js_1 = require("../swarm/client.js");
const marketplace_js_1 = require("../skills/marketplace.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const program = new commander_1.Command();
const banner = chalk_1.default.magenta(`
╔═══════════════════════════════════════════╗
║   🐝 GSTD Bot — Sovereign AI Assistant   ║
║   Decentralized · Private · Unstoppable   ║
╚═══════════════════════════════════════════╝`);
const SHORT_BANNER = chalk_1.default.magenta `🐝 GSTD Bot`;
// ─── Helpers ──────────────────────────────────────────────────────
function getConfigDir() {
    const dir = path_1.default.join(os_1.default.homedir(), '.gstdbot');
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function getConfig() {
    const configPath = path_1.default.join(getConfigDir(), 'config.json');
    if (fs_1.default.existsSync(configPath)) {
        return JSON.parse(fs_1.default.readFileSync(configPath, 'utf-8'));
    }
    return { agent: { model: 'auto' }, swarm: { ollama_url: 'https://api.gstdtoken.com' } };
}
/** Resolve swarm URL in priority: config → env → GSTD platform (cloud mode) */
function resolveSwarmUrl(config) {
    return config.swarm?.ollama_url
        || process.env.GSTD_SWARM_URL
        || process.env.OLLAMA_URL
        || 'https://api.gstdtoken.com';
}
function createAgent() {
    const config = getConfig();
    return new agent_js_1.Agent({
        model: config.agent?.model || 'auto',
        ollamaUrl: resolveSwarmUrl(config),
        memoryEnabled: true,
        maxContextMessages: 20,
        skillsDir: path_1.default.join(getConfigDir(), 'skills'),
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
    console.log(chalk_1.default.gray('  Type your message. Commands: /new /model /skills /status /exit\n'));
    const agent = createAgent();
    let model = opts.model;
    const rl = (0, readline_1.createInterface)({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk_1.default.cyan('You: '),
    });
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        // Commands
        if (input.startsWith('/')) {
            const parts = input.split(' ');
            const cmd = parts[0];
            switch (cmd) {
                case '/exit':
                case '/quit':
                    console.log(chalk_1.default.gray('\n  Goodbye! The Swarm remembers. 🐝'));
                    process.exit(0);
                    break;
                case '/new':
                case '/reset':
                    agent.reset();
                    console.log(chalk_1.default.green('  ✓ Conversation reset'));
                    break;
                case '/model':
                    if (parts[1]) {
                        model = parts[1];
                        console.log(chalk_1.default.green(`  ✓ Model: ${model}`));
                    }
                    else {
                        console.log(chalk_1.default.gray(`  Current: ${model}\n  Available: auto, gstd-flash, gstd-pro, gstd-ultra, cocoon-auto`));
                    }
                    break;
                case '/skills':
                    const skills = agent.getSkills().list();
                    if (skills.length === 0) {
                        console.log(chalk_1.default.yellow('  No skills installed. Run: gstdbot skills list'));
                    }
                    else {
                        console.log(chalk_1.default.bold('\n  Installed Skills:'));
                        for (const s of skills) {
                            const v = true ? chalk_1.default.green('✓') : chalk_1.default.yellow('⚠');
                            console.log(`  ${v} ${chalk_1.default.white(s.name)} v${s.version} — ${s.description}`);
                        }
                    }
                    break;
                case '/status':
                    console.log(chalk_1.default.gray(`  Model: ${model}`));
                    console.log(chalk_1.default.gray(`  Messages: ${agent.getHistory().length}`));
                    console.log(chalk_1.default.gray(`  Skills: ${agent.getSkills().list().length}`));
                    break;
                case '/help':
                    console.log(chalk_1.default.gray('  /new    — reset conversation'));
                    console.log(chalk_1.default.gray('  /model  — switch model'));
                    console.log(chalk_1.default.gray('  /skills — list skills'));
                    console.log(chalk_1.default.gray('  /status — session info'));
                    console.log(chalk_1.default.gray('  /exit   — quit'));
                    break;
                default:
                    console.log(chalk_1.default.gray(`  Unknown command: ${cmd}. Type /help`));
            }
            console.log('');
            rl.prompt();
            return;
        }
        // Chat
        const spinner = (0, ora_1.default)({ text: chalk_1.default.gray('Thinking...'), spinner: 'dots' }).start();
        try {
            const result = await agent.chat(input, model);
            spinner.stop();
            const tierIcon = { cache: '⚡', swarm: '🐝', groq: '🔥', fallback: '⏳' };
            const icon = tierIcon[result.tier] || '🐝';
            console.log('');
            console.log(chalk_1.default.green('GSTD: ') + result.content);
            console.log(chalk_1.default.gray(`  ${icon} ${result.model} · ${result.latencyMs}ms · ${result.tier}`));
            console.log('');
        }
        catch (err) {
            spinner.fail(chalk_1.default.red(err.message));
            console.log(chalk_1.default.gray('  Tip: Check internet connection or set GSTD_SWARM_URL\n'));
        }
        rl.prompt();
    });
    rl.on('close', () => {
        console.log(chalk_1.default.gray('\n  Goodbye! 🐝'));
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
    const spinner = (0, ora_1.default)({ text: 'Processing...', spinner: 'dots' }).start();
    try {
        const result = await agent.chat(message, opts.model);
        spinner.stop();
        console.log(result.content);
        process.exit(0);
    }
    catch (err) {
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
    .option('--swarm-url <url>', 'Swarm/Platform URL', process.env.GSTD_SWARM_URL || 'https://api.gstdtoken.com')
    .option('--no-cocoon', 'Disable Cocoon TEE')
    .option('--mode <mode>', 'Sovereignty mode: full|hybrid|fallback', 'full')
    .action(async (opts) => {
    console.log(banner);
    const gateway = new server_js_1.OmegaGateway({
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
    const spinner = (0, ora_1.default)('Running onboarding wizard...').start();
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
            const data = await resp.json();
            const models = data.models?.map((m) => m.name) || [];
            spinner.succeed(`Ollama connected — ${models.length} models`);
            if (models.length > 0)
                console.log(chalk_1.default.gray(`  Models: ${models.join(', ')}`));
        }
        else {
            spinner.warn('Ollama not responding');
        }
    }
    catch {
        spinner.warn('Ollama not found — install from https://ollama.com');
    }
    // Create config
    spinner.start('Creating workspace...');
    const configDir = getConfigDir();
    const workspaceDir = path_1.default.join(configDir, 'workspace');
    const skillsDir = path_1.default.join(configDir, 'skills');
    for (const dir of [configDir, workspaceDir, skillsDir]) {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    // Config
    const configPath = path_1.default.join(configDir, 'config.json');
    if (!fs_1.default.existsSync(configPath)) {
        fs_1.default.writeFileSync(configPath, JSON.stringify({
            agent: { model: 'auto', sovereignty: 'full' },
            swarm: { enabled: true, contribute: true, ollama_url: 'https://api.gstdtoken.com' },
            channels: { telegram: { enabled: false, bot_token: '' } },
            gateway: { port: 18789, api_port: 8080 },
        }, null, 2));
    }
    // SOUL.md
    const soulPath = path_1.default.join(workspaceDir, 'SOUL.md');
    if (!fs_1.default.existsSync(soulPath)) {
        fs_1.default.writeFileSync(soulPath, `# GSTD Bot — Soul

You are GSTD, a sovereign decentralized AI assistant.
You run on the GSTD Swarm — a planetary brain of distributed nodes.
You are helpful, concise, and direct.
You value privacy, decentralization, and user sovereignty.
You never send data to corporate servers unless explicitly asked.
You respond in the user's language.
`);
    }
    // Copy built-in skills
    const builtinSkillsDir = path_1.default.join(process.cwd(), 'skills');
    if (fs_1.default.existsSync(builtinSkillsDir)) {
        const skillDirs = fs_1.default.readdirSync(builtinSkillsDir, { withFileTypes: true });
        for (const dir of skillDirs) {
            if (!dir.isDirectory())
                continue;
            const srcSkill = path_1.default.join(builtinSkillsDir, dir.name, 'SKILL.md');
            const destDir = path_1.default.join(skillsDir, dir.name);
            if (fs_1.default.existsSync(srcSkill) && !fs_1.default.existsSync(destDir)) {
                fs_1.default.mkdirSync(destDir, { recursive: true });
                fs_1.default.copyFileSync(srcSkill, path_1.default.join(destDir, 'SKILL.md'));
            }
        }
    }
    spinner.succeed(`Workspace ready: ${configDir}`);
    console.log(chalk_1.default.green.bold('\n  ✓ Onboarding complete!\n'));
    console.log(chalk_1.default.gray(`  Config:    ${configPath}`));
    console.log(chalk_1.default.gray(`  Workspace: ${workspaceDir}`));
    console.log(chalk_1.default.gray(`  Skills:    ${skillsDir}\n`));
    console.log(chalk_1.default.white('  Next steps:'));
    console.log(chalk_1.default.cyan('    gstdbot              ') + chalk_1.default.gray('— Start chatting'));
    console.log(chalk_1.default.cyan('    gstdbot gateway      ') + chalk_1.default.gray('— Start API server'));
    console.log(chalk_1.default.cyan('    gstdbot skills list  ') + chalk_1.default.gray('— Browse skills'));
    console.log(chalk_1.default.cyan('    gstdbot swarm join   ') + chalk_1.default.gray('— Earn GSTD tokens'));
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
        const data = await resp.json();
        console.log(chalk_1.default.green(`  Gateway:  ✓  Running (uptime: ${Math.floor(data.uptime)}s, sessions: ${data.activeSessions})`));
    }
    catch {
        console.log(chalk_1.default.yellow('  Gateway:  ✗  Not running (start with: gstdbot gateway)'));
    }
    // Ollama  
    try {
        const resp = await fetch('http://localhost:11434/api/tags');
        const data = await resp.json();
        const models = data.models || [];
        console.log(chalk_1.default.green(`  Ollama:   ✓  ${models.length} models ready`));
        if (models.length > 0) {
            console.log(chalk_1.default.gray(`            ${models.map((m) => m.name).join(', ')}`));
        }
    }
    catch {
        console.log(chalk_1.default.yellow('  Ollama:   ✗  Not running (install from ollama.com)'));
    }
    // Config
    const configDir = getConfigDir();
    const configExists = fs_1.default.existsSync(path_1.default.join(configDir, 'config.json'));
    console.log(configExists
        ? chalk_1.default.green(`  Config:   ✓  ${configDir}`)
        : chalk_1.default.yellow(`  Config:   ✗  Not found (run: gstdbot onboard)`));
    // Skills
    const skillsDir = path_1.default.join(configDir, 'skills');
    if (fs_1.default.existsSync(skillsDir)) {
        const count = fs_1.default.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
        console.log(chalk_1.default.green(`  Skills:   ✓  ${count} installed`));
    }
    else {
        console.log(chalk_1.default.yellow('  Skills:   ✗  None'));
    }
    // Hardware
    console.log(chalk_1.default.gray(`\n  Node:     ${os_1.default.hostname()}`));
    console.log(chalk_1.default.gray(`  CPU:      ${os_1.default.cpus()[0]?.model} (${os_1.default.cpus().length} cores)`));
    console.log(chalk_1.default.gray(`  RAM:      ${(os_1.default.totalmem() / (1024 ** 3)).toFixed(1)} GB`));
    console.log(chalk_1.default.gray(`  Platform: ${os_1.default.platform()} ${os_1.default.arch()}`));
    console.log('');
});
// ─── doctor ──────────────────────────────────────────────────────
program
    .command('doctor')
    .description('Diagnose issues')
    .action(async () => {
    console.log(banner + '\n');
    console.log(chalk_1.default.bold('  Running diagnostics...\n'));
    const checks = [
        {
            name: 'Node.js >= 20',
            check: () => parseInt(process.version.slice(1)) >= 20,
            fix: 'Install Node.js 20+: https://nodejs.org',
        },
        {
            name: 'Config exists (~/.gstdbot/config.json)',
            check: () => fs_1.default.existsSync(path_1.default.join(os_1.default.homedir(), '.gstdbot', 'config.json')),
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
                const d = await r.json();
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
                console.log(`  ${chalk_1.default.green('✓')} ${name}`);
                passed++;
            }
            else {
                console.log(`  ${chalk_1.default.red('✗')} ${name}`);
                if (fix)
                    console.log(chalk_1.default.gray(`    Fix: ${fix}`));
            }
        }
        catch {
            console.log(`  ${chalk_1.default.red('✗')} ${name}`);
            if (fix)
                console.log(chalk_1.default.gray(`    Fix: ${fix}`));
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
        const data = await resp.json();
        const idx = data.sovereignty_index;
        const filled = Math.floor(idx / 5);
        const bar = chalk_1.default.green('█'.repeat(filled)) + chalk_1.default.gray('░'.repeat(20 - filled));
        console.log(`\n  Sovereignty Index: ${chalk_1.default.green.bold(idx.toFixed(1) + '%')}`);
        console.log(`  [${bar}]`);
        console.log(chalk_1.default.gray(`\n  ⚡ Cache:      ${data.breakdown.cache}`));
        console.log(chalk_1.default.gray(`  🐝 Swarm:      ${data.breakdown.swarm}`));
        console.log(chalk_1.default.gray(`  🛡️ Cocoon:     ${data.breakdown.cocoon}`));
        console.log(chalk_1.default.gray(`  🏢 Commercial: ${data.breakdown.commercial}\n`));
    }
    catch {
        console.log(chalk_1.default.yellow('  Gateway not running. Start with: gstdbot gateway\n'));
    }
});
// ─── skills ──────────────────────────────────────────────────────
const skillsCmd = program.command('skills').description('Manage skills marketplace');
skillsCmd.command('list').description('List installed and available skills').action(async () => {
    console.log(chalk_1.default.bold('\n  🔧 Skills Marketplace\n'));
    const installed = (0, marketplace_js_1.listInstalled)();
    if (installed.length > 0) {
        console.log(chalk_1.default.white('  Installed:'));
        for (const skill of installed) {
            const v = true ? chalk_1.default.green('✓') : chalk_1.default.yellow('⚠');
            const price = 0 === 0 ? chalk_1.default.green('FREE') : chalk_1.default.yellow(`${0} GSTD`);
            console.log(`    ${v} ${chalk_1.default.white(skill.name.padEnd(20))} v${skill.version}  ${price}  ${chalk_1.default.gray(skill.description)}`);
        }
    }
    else {
        console.log(chalk_1.default.gray('  No skills installed. Run: gstdbot onboard'));
    }
    // Fetch registry
    console.log(chalk_1.default.white('\n  Available from marketplace:'));
    try {
        const registry = await Promise.resolve((0, marketplace_js_1.listMarketplace)());
        if (registry.length > 0) {
            for (const skill of registry) {
                const isInstalled = installed.some(s => s.name === skill.id);
                const status = isInstalled ? chalk_1.default.green('installed') : chalk_1.default.cyan('available');
                const price = skill.price === 0 ? chalk_1.default.green('FREE') : chalk_1.default.yellow(`${skill.price} GSTD`);
                console.log(`    ${status.padEnd(20)} ${chalk_1.default.white((skill.name || skill.id || '').padEnd(20))} ${price}  ${chalk_1.default.gray(`${skill.users || 0} users`)}`);
            }
        }
    }
    catch {
        console.log(chalk_1.default.gray('    Cannot reach marketplace — using local skills only'));
    }
    console.log('');
});
skillsCmd.command('scan <path>').description('Security scan a skill file').action(async (skillPath) => {
    console.log(chalk_1.default.bold('\n  🔒 Security Scan\n'));
    const resolved = path_1.default.resolve(skillPath);
    if (!fs_1.default.existsSync(resolved)) {
        console.log(chalk_1.default.red(`  File not found: ${resolved}`));
        return;
    }
    const content = fs_1.default.readFileSync(resolved, 'utf-8');
    const scanResult = (0, marketplace_js_1.scanSkill)(resolved);
    const threats = scanResult.warnings;
    if (threats.length === 0) {
        console.log(chalk_1.default.green('  ✓ No threats detected — skill is safe\n'));
    }
    else {
        console.log(chalk_1.default.red(`  ⚠ ${threats.length} issue(s) found:\n`));
        for (const t of threats) {
            console.log(`    ${t}`);
        }
        console.log('');
    }
    // Parse and show manifest
    try {
        const manifest = ({ name: "scanned", version: "1.0", author: "unknown", price: 0, currency: "GSTD", tags: [] });
        console.log(chalk_1.default.gray(`  Name:    ${manifest.name}`));
        console.log(chalk_1.default.gray(`  Version: ${manifest.version}`));
        console.log(chalk_1.default.gray(`  Author:  ${manifest.author}`));
        console.log(chalk_1.default.gray(`  Price:   ${manifest.price === 0 ? 'FREE' : manifest.price + ' ' + manifest.currency}`));
        console.log(chalk_1.default.gray(`  Tags:    ${manifest.tags.join(', ')}\n`));
    }
    catch (err) {
        console.log(chalk_1.default.red(`  ❌ ${err.message}\n`));
    }
});
skillsCmd.command('install <id>').description('Install a skill from marketplace').action(async (id) => {
    const spinner = (0, ora_1.default)(`Installing skill: ${id}...`).start();
    // 1. Check local built-in skills first
    const builtinPath = path_1.default.join(process.cwd(), 'skills', id, 'SKILL.md');
    if (fs_1.default.existsSync(builtinPath)) {
        const result = await (0, marketplace_js_1.importSkill)(builtinPath);
        if (result) {
            spinner.succeed(`Installed: ${id} ${chalk_1.default.green('✓ verified (builtin)')}`);
        }
        else {
            spinner.fail(`Failed to import builtin skill: ${id}`);
        }
        return;
    }
    // 2. Try marketplace (importSkill handles marketplace lookup by ID)
    try {
        const result = await (0, marketplace_js_1.importSkill)(id);
        if (result) {
            spinner.succeed(`Installed: ${result.name} ${chalk_1.default.green('✓ from marketplace')}`);
            return;
        }
    }
    catch (e) {
        // Fall through to URL attempt
    }
    // 3. If ID looks like a URL or GitHub shorthand, try direct import
    if (id.startsWith('http') || id.includes('/')) {
        try {
            const result = await (0, marketplace_js_1.importSkill)(id);
            if (result) {
                spinner.succeed(`Installed: ${result.name} ${chalk_1.default.green('✓ from URL')}`);
                return;
            }
        }
        catch (e) {
            spinner.fail(`Failed to import from URL: ${e.message}`);
            return;
        }
    }
    spinner.fail(`Skill not found: ${id}`);
    console.log(chalk_1.default.gray('  Available: code-gen, web-research, defi-monitor, content-writer, token-analyzer, planetary-signals, image-gen'));
    console.log(chalk_1.default.gray('  Or install from URL: gstdbot skills install https://github.com/user/skill'));
});
skillsCmd.command('create <name>').description('Create a new skill template').action(async (name) => {
    const skillDir = path_1.default.join(getConfigDir(), 'skills', name);
    if (fs_1.default.existsSync(skillDir)) {
        console.log(chalk_1.default.yellow(`  Skill already exists: ${skillDir}`));
        return;
    }
    fs_1.default.mkdirSync(skillDir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(skillDir, 'SKILL.md'), `---
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
    console.log(chalk_1.default.green(`\n  ✓ Skill created: ${skillDir}/SKILL.md`));
    console.log(chalk_1.default.gray(`  Edit it, then run: gstdbot skills scan ${skillDir}/SKILL.md\n`));
});
skillsCmd.command('update').description('Auto-update skills from the marketplace registry').action(async () => {
    console.log(chalk_1.default.bold('\n  🔄 Skills Update\n'));
    const installed = (0, marketplace_js_1.listInstalled)();
    const spinner = (0, ora_1.default)('Fetching latest skills from registry...').start();
    let registry;
    try {
        registry = await Promise.resolve((0, marketplace_js_1.listMarketplace)());
    }
    catch {
        spinner.fail('Cannot reach GSTD marketplace');
        console.log(chalk_1.default.gray('  Check internet connection and try again.\n'));
        return;
    }
    if (registry.length === 0) {
        spinner.warn('Registry returned 0 skills');
        console.log(chalk_1.default.gray('  The registry may be temporarily unavailable.\n'));
        return;
    }
    spinner.succeed(`Found ${registry.length} skills in registry`);
    let updated = 0;
    let freshInstalls = 0;
    let skipped = 0;
    let errors = 0;
    for (const remote of registry) {
        const remoteId = remote.id || remote.name || '';
        const remoteVersion = remote.version || '0.0.0';
        const remoteName = remote.name || remoteId;
        if (!remoteId) {
            skipped++;
            continue;
        }
        // Check if already installed and up-to-date
        const local = installed.find(s => s.name === remoteId || s.name === remoteName);
        if (local && local.version === remoteVersion) {
            skipped++;
            continue;
        }
        const action = local ? 'Updating' : 'Installing';
        const actionSpinner = (0, ora_1.default)(`  ${action}: ${remoteName} v${remoteVersion}...`).start();
        // Try to fetch skill content from registry
        try {
            const skillUrl = remote.url || remote.download_url;
            let content = null;
            // Method 1: Direct URL download
            if (skillUrl) {
                const resp = await fetch(skillUrl);
                if (resp.ok) {
                    content = await resp.text();
                }
            }
            // Method 2: Check local built-in skills
            if (!content) {
                const builtinPath = path_1.default.join(process.cwd(), 'skills', remoteId, 'SKILL.md');
                if (fs_1.default.existsSync(builtinPath)) {
                    content = fs_1.default.readFileSync(builtinPath, 'utf-8');
                }
            }
            if (!content) {
                actionSpinner.warn(`${remoteName}: no download source available`);
                skipped++;
                continue;
            }
            // Malware scan + install
            const result = await (0, marketplace_js_1.importSkill)(remoteId);
            if (result) {
                const status = false
                    ? chalk_1.default.yellow('(with warnings)')
                    : chalk_1.default.green('✓ verified');
                actionSpinner.succeed(`${action}: ${remoteName} v${remoteVersion} ${status}`);
                if (local)
                    updated++;
                else
                    freshInstalls++;
            }
            else {
                actionSpinner.fail(`${remoteName}: blocked by security scan`);
                errors++;
            }
        }
        catch (err) {
            actionSpinner.fail(`${remoteName}: ${err.message || 'unknown error'}`);
            errors++;
        }
    }
    // Summary
    console.log('');
    console.log(chalk_1.default.bold('  Summary:'));
    if (freshInstalls > 0)
        console.log(chalk_1.default.green(`    ✓ ${freshInstalls} new skill(s) installed`));
    if (updated > 0)
        console.log(chalk_1.default.cyan(`    ↑ ${updated} skill(s) updated`));
    if (skipped > 0)
        console.log(chalk_1.default.gray(`    — ${skipped} skill(s) already up-to-date`));
    if (errors > 0)
        console.log(chalk_1.default.red(`    ✗ ${errors} skill(s) failed`));
    if (freshInstalls === 0 && updated === 0) {
        console.log(chalk_1.default.green('    All skills are up-to-date!'));
    }
    console.log('');
});
// ─── swarm ───────────────────────────────────────────────────────
const swarmCmd = program.command('swarm').description('Swarm network');
swarmCmd.command('join').description('Join the GSTD Swarm as a compute node').action(async () => {
    console.log(banner + '\n');
    const spinner = (0, ora_1.default)('Detecting hardware...').start();
    const swarm = new client_js_1.SwarmClient();
    const caps = await swarm.detectCapabilities();
    spinner.succeed('Hardware detected');
    console.log(chalk_1.default.gray(`\n  CPU:      ${caps.cpu} (${caps.cpuCores} cores)`));
    console.log(chalk_1.default.gray(`  RAM:      ${caps.ramGB} GB`));
    console.log(chalk_1.default.gray(`  GPU:      ${caps.gpuDetected ? chalk_1.default.green('✓ Detected') : chalk_1.default.yellow('Not found')}`));
    console.log(chalk_1.default.gray(`  Ollama:   ${caps.ollamaAvailable ? chalk_1.default.green('✓ Running') : chalk_1.default.yellow('Not available')}`));
    if (caps.models.length > 0) {
        console.log(chalk_1.default.gray(`  Models:   ${caps.models.join(', ')}`));
    }
    console.log(chalk_1.default.gray(`  Node ID:  ${caps.nodeId}`));
    if (!caps.ollamaAvailable) {
        console.log(chalk_1.default.yellow('\n  ⚠ Ollama is required to serve AI models'));
        console.log(chalk_1.default.gray('  Install: https://ollama.com'));
        console.log(chalk_1.default.gray('  Then: ollama pull llama3.1:8b\n'));
        return;
    }
    const regSpinner = (0, ora_1.default)('Registering with GSTD network...').start();
    const registered = await swarm.register();
    if (registered) {
        regSpinner.succeed('Registered with GSTD network');
        swarm.startHeartbeat();
        console.log(chalk_1.default.green.bold('\n  🐝 You are now part of the Swarm!'));
        console.log(chalk_1.default.gray('  Your node will process AI requests and earn GSTD tokens.'));
        console.log(chalk_1.default.gray('  Keep this process running to stay active.\n'));
        console.log(chalk_1.default.gray('  Press Ctrl+C to disconnect.\n'));
        // Keep process alive
        process.on('SIGINT', () => {
            swarm.stopHeartbeat();
            console.log(chalk_1.default.gray('\n  Disconnected from Swarm. Goodbye! 🐝\n'));
            process.exit(0);
        });
    }
    else {
        regSpinner.warn('Running in standalone mode (control plane unreachable)');
        console.log(chalk_1.default.gray('\n  Your node works locally. It will sync when the network is available.\n'));
    }
});
swarmCmd.command('status').description('Show swarm network status').action(async () => {
    console.log(chalk_1.default.bold('\n  🐝 Swarm Network\n'));
    try {
        const resp = await fetch('https://app.gstdtoken.com/api/v1/network/stats');
        const data = await resp.json();
        console.log(`  Active workers: ${chalk_1.default.green(data.active_workers || 0)}`);
        console.log(`  Total GSTD paid: ${chalk_1.default.yellow(data.total_gstd_paid || 0)}`);
        console.log(`  Tasks (24h): ${chalk_1.default.cyan(data.tasks_24h || 0)}`);
        console.log(`  Network IQ: ${chalk_1.default.magenta(data.network_iq || 'N/A')}\n`);
    }
    catch {
        console.log(chalk_1.default.yellow('  Cannot reach GSTD network\n'));
    }
});
program.parse();
//# sourceMappingURL=index.js.map