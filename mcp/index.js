#!/usr/bin/env node
/**
 * GSTD Network MCP Server
 * Hosted endpoint: https://platform.gstdtoken.com/mcp
 *
 * Install via Claude Code:
 *   claude mcp add --transport http gstd https://platform.gstdtoken.com/mcp
 */

const ENDPOINT = 'https://platform.gstdtoken.com/mcp';

console.log('GSTD Network MCP Server');
console.log('');
console.log('Hosted endpoint:', ENDPOINT);
console.log('');
console.log('Install in Claude Code:');
console.log(`  claude mcp add --transport http gstd ${ENDPOINT}`);
console.log('');
console.log('GitHub: https://github.com/gstdcoin/gstdbot/tree/main/mcp');
console.log('Website: https://gstdtoken.com');
