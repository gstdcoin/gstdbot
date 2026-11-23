export const DEFAULT_GSTD_API_URL = 'https://app.gstdtoken.xyz/api/v1';
// Only known former defaults migrate; operator-owned endpoints remain explicit.
const LEGACY_GSTD_API_URLS = new Set([
    'https://platform.gstdtoken.com/api/v1',
    'https://app.gstdtoken.com/api/v1',
    'https://platform.gstdtoken.xyz/api/v1',
]);

export function normalizeGstdApiUrl(configuredUrl?: string): string {
    const normalizedUrl = configuredUrl?.replace(/\/+$/, '');
    if (!configuredUrl || !normalizedUrl || LEGACY_GSTD_API_URLS.has(normalizedUrl)) {
        return DEFAULT_GSTD_API_URL;
    }
    return configuredUrl;
}
