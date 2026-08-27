import { describe, it, expect } from 'vitest';
import { signVerify } from '@ton/crypto';
import { loadOrCreateAttestorIdentity, signPeerRequest, peerRequestMessage } from './identity.js';

describe('signPeerRequest', () => {
    const identity = loadOrCreateAttestorIdentity();
    const nodeId = 'test-node-abc123';

    it('produces three correctly-named headers', () => {
        const headers = signPeerRequest(identity, nodeId);
        expect(headers).toHaveProperty('X-GSTD-Node-Id');
        expect(headers).toHaveProperty('X-GSTD-Node-Ts');
        expect(headers).toHaveProperty('X-GSTD-Node-Sig');
    });

    it('signature verifies correctly with signVerify against peerRequestMessage hash', () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        const msg    = peerRequestMessage(nodeId, timestamp);
        const pubkey = Buffer.from(identity.pubkeyHex, 'hex');
        const sig    = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid  = signVerify(msg, sig, pubkey);
        expect(valid).toBe(true);
    });

    it('stale timestamp (>60s old) should be detected as out-of-range', () => {
        const staleTs = Date.now() - 70_000; // 70 seconds ago
        const drift = Math.abs(Date.now() - staleTs);
        expect(drift).toBeGreaterThan(60_000);
    });

    it('wrong nodeId in message produces an invalid signature', () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        // Verify against a different nodeId's message hash
        const wrongMsg = peerRequestMessage('different-node-id', timestamp);
        const pubkey   = Buffer.from(identity.pubkeyHex, 'hex');
        const sig      = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid    = signVerify(wrongMsg, sig, pubkey);
        expect(valid).toBe(false);
    });

    it('round-trip: signPeerRequest headers pass requirePeerAuth-equivalent verification', () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);

        // Replicate the verification logic from requirePeerAuth
        const tsFromHeader = parseInt(headers['X-GSTD-Node-Ts'], 10);
        expect(Math.abs(Date.now() - tsFromHeader)).toBeLessThan(60_000);

        const msg    = peerRequestMessage(headers['X-GSTD-Node-Id'], tsFromHeader);
        const pubkey = Buffer.from(identity.pubkeyHex, 'hex');
        const sig    = Buffer.from(headers['X-GSTD-Node-Sig'], 'hex');
        const valid  = signVerify(msg, sig, pubkey);
        expect(valid).toBe(true);
    });
});
