#!/usr/bin/env node
/**
 * GSTD Bot CLI — Command-line interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { OmegaGateway } from '../gateway/server.js';
import { TelegramChannel } from '../channels/telegram.js';

const program = new Command();

const banner = `
${chalk.magenta('╔══════════════════════════════════════╗')}
${chalk.magenta('║')}   ${chalk.bold.white('🐝 GSTD Bot')} ${chalk.gray('— Sovereign AI Agent')}   ${chalk.magenta('║')}
${chalk.magenta('╚══════════════════════════════════════╝')}
`;

program
    .name('gstdbot')
    .description('Sovereign Decentralized AI Assistant')
    .version('1.0.0');

// ─── gateway ─────────────────────────────────────────────────────
program
    .command('gateway')
    .description('Start the Omega Gateway')
    .option('-p, --port <port>', 'API port', '8080')
    .option('--swarm-url <url>', 'Swarm (Ollama) URL', 'http://localhost:11434')
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
    .action(async (opts) => {
        console.log(banner);
        const spinner = ora('Running onboarding wizard...').start();

        // Check dependencies
        spinner.text = 'Checking Node.js version...';
        const nodeVersion = process.version;
        const major = parseInt(nodeVersion.slice(1));
        if (major < 20) {
            spinner.fail(`Node.js ${nodeVersion} is too old. Need >= 20.`);
            process.exit(1);
        }
        spinner.succeed(`Node.js ${nodeVersion} ✓`);

        // Check Ollama
        spinner.start('Checking Swarm (Ollama) connection...');
        try {
            const resp = await fetch('http://localhost:11434/api/tags');
            if (resp.ok) {
                const data: any = await resp.json();
                const models = data.models?.map((m: any) => m.name) || [];
                spinner.succeed(`Ollama connected — ${models.length} models available`);
                if (models.length > 0) {
                    console.log(chalk.gray(`  Models: ${models.join(', ')}`));
                }
            } else {
                spinner.warn('Ollama not responding — Swarm will use fallback');
            }
        } catch {
            spinner.warn('Ollama not found — install from https://ollama.com');
        }

        // Create config
        spinner.start('Creating configuration...');
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');
        const configDir = path.join(os.homedir(), '.gstdbot');

        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        const configPath = path.join(configDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify({
                agent: { model: 'auto', sovereignty: 'full' },
                swarm: { enabled: true, contribute: true, ollama_url: 'http://localhost:11434' },
                channels: { telegram: { enabled: false, bot_token: '' } },
                gateway: { port: 18789, api_port: 8080 },
            }, null, 2));
            spinner.succeed(`Config created: ${configPath}`);
        } else {
            spinner.succeed('Config already exists');
        }

        // Create workspace
        const workspacePath = path.join(configDir, 'workspace');
        const skillsPath = path.join(workspacePath, 'skills');
        if (!fs.existsSync(skillsPath)) {
            fs.mkdirSync(skillsPath, { recursive: true });
        }

        // Write SOUL.md
        const soulPath = path.join(workspacePath, 'SOUL.md');
        if (!fs.existsSync(soulPath)) {
            fs.writeFileSync(soulPath, `# GSTD Bot — Soul

You are GSTD, a sovereign decentralized AI assistant.
You run on the GSTD Swarm — a planetary brain of distributed nodes.
You are helpful, concise, and direct.
You value privacy, decentralization, and user sovereignty.
You never send data to corporate servers unless explicitly asked.
`);
        }

        console.log('\n' + chalk.green.bold('✓ Onboarding complete!'));
        console.log(chalk.gray(`
  Config:    ${configPath}
  Workspace: ${workspacePath}
  
  Next steps:
    ${chalk.white('gstdbot gateway')}        — Start the gateway
    ${chalk.white('gstdbot status')}         — Check status
    ${chalk.white('gstdbot chat')}           — Start chatting
    ${chalk.white('gstdbot swarm join')}     — Join as compute node
        `));
    });

// ─── status ──────────────────────────────────────────────────────
program
    .command('status')
    .description('Show node and gateway status')
    .action(async () => {
        console.log(banner);
        try {
            const resp = await fetch('http://localhost:8080/health');
            const data: any = await resp.json();
            console.log(chalk.green(`Gateway: ✓ Running (uptime: ${Math.floor(data.uptime)}s)`));
            console.log(chalk.gray(`  Sessions: ${data.activeSessions}`));
            console.log(chalk.gray(`  Clients:  ${data.connectedClients}`));
        } catch {
            console.log(chalk.yellow('Gateway: ✗ Not running'));
            console.log(chalk.gray('  Start with: gstdbot gateway'));
        }

        // Check Ollama
        try {
            const resp = await fetch('http://localhost:11434/api/tags');
            const data: any = await resp.json();
            const models = data.models?.length || 0;
            console.log(chalk.green(`Swarm:   ✓ Ollama connected (${models} models)`));
        } catch {
            console.log(chalk.yellow('Swarm:   ✗ Ollama not running'));
        }
    });

// ─── doctor ──────────────────────────────────────────────────────
program
    .command('doctor')
    .description('Diagnose issues')
    .action(async () => {
        console.log(banner);
        console.log(chalk.bold('Running diagnostics...\n'));

        const checks = [
            { name: 'Node.js >= 20', check: () => parseInt(process.version.slice(1)) >= 20 },
            { name: 'Gateway reachable', check: async () => { const r = await fetch('http://localhost:8080/health'); return r.ok; } },
            { name: 'Ollama reachable', check: async () => { const r = await fetch('http://localhost:11434/api/tags'); return r.ok; } },
            { name: 'Config exists', check: async () => { const fs = await import('fs'); const os = await import('os'); const path = await import('path'); return fs.existsSync(path.join(os.homedir(), '.gstdbot', 'config.json')); } },
        ];

        for (const { name, check } of checks) {
            try {
                const ok = await check();
                console.log(`  ${ok ? chalk.green('✓') : chalk.red('✗')} ${name}`);
            } catch {
                console.log(`  ${chalk.red('✗')} ${name}`);
            }
        }
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
            const bar = '█'.repeat(Math.floor(idx / 5)) + '░'.repeat(20 - Math.floor(idx / 5));
            console.log(`\n  Sovereignty Index: ${chalk.green.bold(idx.toFixed(1) + '%')}`);
            console.log(`  [${chalk.green(bar)}]`);
            console.log(chalk.gray(`\n  Cache:      ${data.breakdown.cache}`));
            console.log(chalk.gray(`  Swarm:      ${data.breakdown.swarm}`));
            console.log(chalk.gray(`  Cocoon:     ${data.breakdown.cocoon}`));
            console.log(chalk.gray(`  Commercial: ${data.breakdown.commercial}`));
        } catch {
            console.log(chalk.yellow('Gateway not running. Start with: gstdbot gateway'));
        }
    });

// ─── skills ──────────────────────────────────────────────────────
const skills = program.command('skills').description('Manage skills');

skills.command('list').description('List available skills').action(async () => {
    try {
        const resp = await fetch('http://localhost:8080/v1/skills');
        const data: any = await resp.json();
        console.log(chalk.bold('\n  Available Skills:\n'));
        for (const skill of data.data) {
            const price = skill.price === 0 ? chalk.green('FREE') : chalk.yellow(`${skill.price} GSTD`);
            const beta = skill.beta ? chalk.gray(' (beta)') : '';
            console.log(`  ${skill.active ? '🟢' : '⚪'} ${chalk.white(skill.name.padEnd(20))} ${price}  ${chalk.gray(`${skill.users} users`)}${beta}`);
        }
    } catch {
        console.log(chalk.yellow('Gateway not running.'));
    }
});

// ─── swarm ───────────────────────────────────────────────────────
const swarm = program.command('swarm').description('Swarm network');

swarm.command('status').description('Show swarm status').action(async () => {
    try {
        const resp = await fetch('http://localhost:8080/v1/swarm/status');
        const data: any = await resp.json();
        console.log(chalk.bold('\n  🐝 Swarm Status:\n'));
        console.log(`  Nodes:           ${chalk.green(data.nodes)}`);
        console.log(`  Models:          ${chalk.white(data.models_available.join(', '))}`);
        console.log(`  Compute Hours:   ${chalk.cyan(data.total_compute_hours)}`);
        console.log(`  GSTD Earned:     ${chalk.yellow(data.gstd_distributed)}`);
    } catch {
        console.log(chalk.yellow('Gateway not running.'));
    }
});

swarm.command('join').description('Join the swarm as a compute node').action(async () => {
    console.log(chalk.bold('\n  Joining GSTD Swarm...\n'));
    console.log(chalk.gray('  Prerequisites:'));
    console.log(chalk.gray('  • Ollama installed with at least one model'));
    console.log(chalk.gray('  • Stable internet connection'));
    console.log(chalk.gray('  • GSTD wallet address\n'));
    console.log(chalk.yellow('  Coming soon: automated node registration'));
});

program.parse();
