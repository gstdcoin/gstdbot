import { describe, it, expect } from 'vitest';
import { signVerify } from '@ton/crypto';
import { loadOrCreateAttestorIdentity, signPeerRequest, peerRequestMessage, isStaleTimestamp, verifyPeerRequest } from './identity.js';

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

    it('isStaleTimestamp rejects timestamps older than 60s', () => {
        expect(isStaleTimestamp(Date.now() - 70_000)).toBe(true);  // 70s ago — stale
        expect(isStaleTimestamp(Date.now())).toBe(false);           // now — fresh
        expect(isStaleTimestamp(Date.now() + 70_000)).toBe(true);  // 70s in future — also stale
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

describe('verifyPeerRequest (end-to-end requirePeerAuth verification path)', () => {
    const identity = loadOrCreateAttestorIdentity();
    const nodeId = 'test-node-e2e';

    it('accepts a valid signed request', async () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        const result = await verifyPeerRequest(
            headers['X-GSTD-Node-Id'],
            parseInt(headers['X-GSTD-Node-Ts'], 10),
            headers['X-GSTD-Node-Sig'],
            identity.pubkeyHex
        );
        expect(result).toBe(true);
    });

    it('rejects a request with a tampered signature', async () => {
        const timestamp = Date.now();
        const headers = signPeerRequest(identity, nodeId, timestamp);
        // Flip one byte in the hex signature
        const tamperedSig = 'ff' + headers['X-GSTD-Node-Sig'].slice(2);
        const result = await verifyPeerRequest(
            headers['X-GSTD-Node-Id'],
            parseInt(headers['X-GSTD-Node-Ts'], 10),
            tamperedSig,
            identity.pubkeyHex
        );
        expect(result).toBe(false);
    });
});
