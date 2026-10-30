#!/usr/bin/env node
// Portable installer configuration: do not depend on GNU/BSD sed differences.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
function envLine(key, value) {
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw Error(key + ' must be one line');
    for (const quote of ["'", '"', '`']) {
        if (!value.includes(quote)) {
            const line = key + '=' + quote + value + quote;
            if (parseEnv(line)[key] === value) return line;
        }
    }
    throw Error(key + ' contains unsupported quoting; choose a simple display name');
}
function configure({ envFile, tokenFile, nodeName, walletAddress }) {
    let env = fs.readFileSync(envFile, 'utf8');
    const set = (key, value) => {
        const line = envLine(key, value), pattern = new RegExp('^' + key + '=.*$', 'm');
        env = pattern.test(env) ? env.replace(pattern, () => line) : env + '\n' + line + '\n';
    };
    if (nodeName) set('NODE_NAME', nodeName);
    if (walletAddress) set('GSTD_WALLET_ADDRESS', walletAddress);
    const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid existing setup-token file; review it manually.');
    set('GSTD_DASHBOARD_SETUP_TOKEN', token);
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, token + '\n', { mode: 0o600, flag: 'wx' });
    fs.chmodSync(tokenFile, 0o600);
    fs.writeFileSync(envFile, env, { mode: 0o600 });
    fs.chmodSync(envFile, 0o600);
}
module.exports = { configure, envLine };
if (require.main === module) configure({envFile:process.env.GSTD_SETUP_ENV,tokenFile:process.env.GSTD_SETUP_TOKEN_FILE,
    nodeName:process.env.GSTD_SETUP_NODE_NAME,walletAddress:process.env.GSTD_SETUP_WALLET_ADDRESS});
