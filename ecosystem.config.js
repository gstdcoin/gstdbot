const fs   = require('fs');
const path = require('path');
const os   = require('os');

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

// ─── Dynamic paths — works on any machine, not just the Pi ───────────────
const HOME      = process.env.HOME || os.homedir();
const INSTALL   = __dirname;                         // wherever the repo lives
const NODE_BIN  = process.execPath;                  // node that launched pm2

// Resolve Ollama binary: try common install locations in order
function findOllama() {
  const candidates = [
    path.join(HOME, 'ollama-bin', 'bin', 'ollama'),  // Pi custom location
    path.join(HOME, '.ollama', 'bin', 'ollama'),
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

// Resolve IPFS binary
function findIpfs() {
  const candidates = [
    path.join(HOME, 'ipfs-bin', 'ipfs'),  // install.sh puts it here
    path.join(HOME, '.local', 'bin', 'ipfs'),
    '/usr/local/bin/ipfs',
    '/usr/bin/ipfs',
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

const OLLAMA_BIN = findOllama();
const IPFS_BIN   = findIpfs();
const LOGS       = path.join(INSTALL, 'logs');

const dotenv = loadEnv(path.join(INSTALL, '.env'));

module.exports = {
  apps: [
  {
    name: 'ollama',
    script: OLLAMA_BIN,
    args: 'serve',
    cwd: HOME,
    env: {
      OLLAMA_HOME: path.join(HOME, '.ollama'),
      HOME,
    },
    autorestart: true,
    restart_delay: 5000,
    out_file:   path.join(LOGS, 'ollama.log'),
    error_file: path.join(LOGS, 'ollama.error.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '3G',
  },
  {
    name: 'ipfs',
    script: IPFS_BIN,
    args: 'daemon --migrate=true',
    cwd: HOME,
    env: {
      IPFS_PATH: path.join(HOME, '.ipfs'),
      HOME,
    },
    autorestart: true,
    restart_delay: 10000,
    out_file:   path.join(LOGS, 'ipfs.log'),
    error_file: path.join(LOGS, 'ipfs.error.log'),
    max_memory_restart: '512M',
  },
  {
    name: 'tunnel',
    script: path.join(INSTALL, 'tunnel.sh'),
    interpreter: '/bin/bash',
    cwd: INSTALL,
    env: { ...dotenv },
    autorestart: true,
    restart_delay: 5000,
    out_file:   path.join(LOGS, 'tunnel.log'),
    error_file: path.join(LOGS, 'tunnel.error.log'),
    merge_logs: true,
    max_memory_restart: '256M',
  },
  {
    name: 'gstdbot',
    script: 'dist/index.js',
    cwd: INSTALL,
    interpreter: NODE_BIN,
    env: {
      NODE_ENV: 'production',
      GSTD_NAAS_ENABLED: 'false',
      HOME,
      ...dotenv,
    },
    // Restart policy
    autorestart: true,
    restart_delay: 15000,
    max_restarts: 10,
    min_uptime: '30s',
    // Logs
    out_file:   path.join(LOGS, 'node.log'),
    error_file: path.join(LOGS, 'node.error.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // Resource limits
    max_memory_restart: '900M',
    node_args: '--max-old-space-size=768',
  }]
};
