const fs = require('fs');
const path = require('path');

// Parse .env file manually so vars are available even if pm2 env_file is buggy
function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) env[key] = val;
  });
  return env;
}

const dotenv = loadEnv(path.join(__dirname, '.env'));

module.exports = {
  apps: [
  {
    name: 'ollama',
    script: '/home/bot/ollama-bin/bin/ollama',
    args: 'serve',
    cwd: '/home/bot',
    env: {
      OLLAMA_HOME: '/home/bot/.ollama',
      HOME: '/home/bot',
    },
    autorestart: true,
    restart_delay: 5000,
    out_file: '/home/bot/gstdbot/logs/ollama.log',
    error_file: '/home/bot/gstdbot/logs/ollama.error.log',
  },
  {
    name: 'gstdbot',
    script: 'dist/index.js',
    cwd: '/home/bot/gstdbot',
    interpreter: '/home/bot/.nvm/versions/node/v20.20.2/bin/node',
    env: {
      NODE_ENV: 'production',
      ...dotenv,
    },
    // Restart policy
    restart_delay: 15000,
    max_restarts: 10,
    min_uptime: '30s',
    // Logs
    out_file: '/home/bot/gstdbot/logs/node.log',
    error_file: '/home/bot/gstdbot/logs/node.error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // Resource limits — don't compete with trading bot
    max_memory_restart: '900M',
    node_args: '--max-old-space-size=768',
  }]
};
