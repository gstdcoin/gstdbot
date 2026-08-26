import { defineConfig } from 'vitest/config';

// Set env var BEFORE modules are imported
process.env.GSTD_CONFIG_DIR = '/tmp/gstd-vitest-config-dir';

export default defineConfig({
    test: {
        env: {
            GSTD_CONFIG_DIR: '/tmp/gstd-vitest-config-dir',
        },
        setupFiles: ['./vitest.setup.ts'],
    },
});
