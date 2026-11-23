import { describe, expect, it } from 'vitest';
import { DEFAULT_GSTD_API_URL, normalizeGstdApiUrl } from './api-url.js';

describe('normalizeGstdApiUrl', () => {
    it('defaults to the deployed application API', () => {
        expect(normalizeGstdApiUrl()).toBe(DEFAULT_GSTD_API_URL);
    });

    it('migrates the legacy platform host, including a trailing slash', () => {
        expect(normalizeGstdApiUrl('https://platform.gstdtoken.xyz/api/v1/'))
            .toBe(DEFAULT_GSTD_API_URL);
    });

    it('migrates former official application defaults without expanding custom endpoint trust', () => {
        expect(normalizeGstdApiUrl('https://app.gstdtoken.com/api/v1/')).toBe(DEFAULT_GSTD_API_URL);
        expect(normalizeGstdApiUrl('https://platform.gstdtoken.com/api/v1')).toBe(DEFAULT_GSTD_API_URL);
        expect(normalizeGstdApiUrl('https://app.gstdtoken.com.attacker.example/api/v1'))
            .toBe('https://app.gstdtoken.com.attacker.example/api/v1');
    });

    it.each(['https://platform.gstdtoken.com/api/v1', 'https://app.gstdtoken.com/api/v1/'])(
        'migrates a saved former default without changing the node identity (%s)', url => {
            expect(normalizeGstdApiUrl(url)).toBe('https://app.gstdtoken.xyz/api/v1');
        },
    );

    it('preserves explicitly configured custom API hosts', () => {
        expect(normalizeGstdApiUrl('https://api.example.test/v1'))
            .toBe('https://api.example.test/v1');
    });
});
