import { rmSync } from 'fs';
import { beforeAll } from 'vitest';

// Ensure the test config dir is empty before any tests run
beforeAll(() => {
    const testConfigDir = process.env.GSTD_CONFIG_DIR || '/tmp/gstd-vitest-config-dir';
    try {
        rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
        // Directory doesn't exist yet, that's fine
    }
});
