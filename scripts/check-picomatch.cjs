const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lock = require('../package-lock.json');
const target = fs.realpathSync(path.join(root, 'vendor/picomatch/index.js'));
const fork = require('../vendor/picomatch/package.json');
assert.equal(fork.name, '@gstdcoin/picomatch');
assert.equal(fork.version, '4.0.7-gstd.1');
for (const [location, entry] of Object.entries(lock.packages)) {
    if (location.endsWith('/picomatch') && location !== 'vendor/picomatch') {
        assert.equal(entry.link, true, 'Unpatched Picomatch remains in ' + location);
        assert.equal(entry.resolved, 'vendor/picomatch');
    }
    if (entry.dependencies?.picomatch || entry.optionalDependencies?.picomatch) {
        const consumer = path.join(root, location);
        if (!fs.existsSync(consumer)) continue;
        assert.equal(fs.realpathSync(require.resolve('picomatch', { paths: [consumer] })), target,
            'Consumer resolves a different Picomatch: ' + location);
    }
}
assert.equal(fs.realpathSync(require.resolve('picomatch')), target);
console.log('All installed Picomatch consumers resolve the checked local fork.');
