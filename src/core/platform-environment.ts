/** Upgrade only former official defaults, preserving private/custom endpoints. */
export function migratePlatformEnvironment(env: Record<string, string | undefined>): void {
    for (const key of ['GSTD_API_URL', 'GSTD_SWARM_URL']) {
        const value = env[key];
        if (!value) continue;
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
                !['app.gstdtoken.com', 'platform.gstdtoken.com'].includes(url.hostname) || url.port ||
                !['/', '/api/v1', '/api/v1/'].includes(url.pathname)) continue;
            url.hostname = 'app.gstdtoken.xyz';
            url.pathname = key === 'GSTD_API_URL' ? '/api/v1' : '/';
            env[key] = url.toString().replace(/\/$/, '');
        } catch { /* Preserve explicit configuration for normal validation. */ }
    }
}

migratePlatformEnvironment(process.env);
