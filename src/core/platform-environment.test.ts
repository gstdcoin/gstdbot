import { describe, expect, it } from 'vitest';
import { migratePlatformEnvironment } from './platform-environment.js';
describe('canonical domain for persisted process settings', () => {
    it('migrates both known former API and swarm addresses without changing unrelated state', () => {
        const env = { GSTD_API_URL: 'https://app.gstdtoken.com/api/v1/', GSTD_SWARM_URL: 'https://platform.gstdtoken.com',
            GSTD_NODE_ID: 'keep-identity', PLATFORM_SIGNING_ENFORCED: 'true' };
        migratePlatformEnvironment(env);
        expect(env).toEqual({ GSTD_API_URL: 'https://app.gstdtoken.xyz/api/v1', GSTD_SWARM_URL: 'https://app.gstdtoken.xyz',
            GSTD_NODE_ID: 'keep-identity', PLATFORM_SIGNING_ENFORCED: 'true' });
    });
    it('keeps the API prefix on API settings and removes it from the swarm origin', () => {
        const env = { GSTD_API_URL: 'https://app.gstdtoken.com', GSTD_SWARM_URL: 'https://app.gstdtoken.com/api/v1/' };
        migratePlatformEnvironment(env);
        expect(env).toEqual({ GSTD_API_URL: 'https://app.gstdtoken.xyz/api/v1', GSTD_SWARM_URL: 'https://app.gstdtoken.xyz' });
    });
    it.each(['https://app.gstdtoken.com.attacker.test/api/v1', 'https://custom.example/api/v1',
        'https://name:password@app.gstdtoken.com/api/v1', 'https://app.gstdtoken.com/api/v1?credential=private'])('preserves custom or credential-bearing settings (%s)', value => {
        const env = { GSTD_API_URL: value }; migratePlatformEnvironment(env); expect(env.GSTD_API_URL).toBe(value);
    });
});
