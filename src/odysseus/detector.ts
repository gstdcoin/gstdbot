/**
 * Odysseus Detector
 * Checks if Odysseus is running on localhost:7000 and returns its available endpoints.
 */

export interface OdysseusInfo {
    running:    boolean;
    url:        string;
    has_chat:   boolean;
    has_search: boolean;
    has_docs:   boolean;
    models:     string[];
}

const ODYSSEUS_DEFAULT_URL = process.env.ODYSSEUS_URL || 'http://localhost:7000';

export async function detectOdysseus(url = ODYSSEUS_DEFAULT_URL): Promise<OdysseusInfo> {
    const base: OdysseusInfo = {
        running:    false,
        url,
        has_chat:   false,
        has_search: false,
        has_docs:   false,
        models:     [],
    };

    try {
        // Quick health check — Odysseus exposes root or /api/health
        const resp = await fetch(`${url}/api/health`, {
            signal: AbortSignal.timeout(2000),
        }).catch(() => fetch(`${url}/`, { signal: AbortSignal.timeout(2000) }));

        if (!resp.ok && resp.status !== 404) return base;

        base.running = true;

        // Probe known Odysseus endpoints
        const probes = await Promise.allSettled([
            fetch(`${url}/api/chat`,   { method: 'OPTIONS', signal: AbortSignal.timeout(1500) }),
            fetch(`${url}/api/search`, { method: 'OPTIONS', signal: AbortSignal.timeout(1500) }),
        ]);

        // If OPTIONS fails with 405 (not allowed) the endpoint still exists
        base.has_chat   = probes[0].status === 'fulfilled' && probes[0].value.status !== 404;
        base.has_search = probes[1].status === 'fulfilled' && probes[1].value.status !== 404;
        base.has_docs   = base.has_chat; // docs analysis uses chat under the hood

        // Build GSTD model IDs for advertising to the network
        if (base.has_chat)   base.models.push('odysseus-chat');
        if (base.has_search) base.models.push('odysseus-research');
        if (base.has_docs)   base.models.push('odysseus-docs');

    } catch {
        // Odysseus not running — that's fine, not required
    }

    return base;
}
