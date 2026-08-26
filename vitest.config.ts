import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const testConfigDir = mkdtempSync(join(tmpdir(), 'gstd-vitest-config-dir-'));

export default defineConfig({
    test: {
        env: {
            GSTD_CONFIG_DIR: testConfigDir,
        },
    },
});
