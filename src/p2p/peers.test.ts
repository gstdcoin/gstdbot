import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';
import { PeerManager } from './peers.js';

// PeerManager persists its table to $GSTD_CONFIG_DIR/peers.json and reloads it in
// its constructor, so without this each test would inherit the previous test's peers.
const PEERS_FILE = join(process.env.GSTD_CONFIG_DIR || '/home/bot/.config/gstdbot', 'peers.json');

describe('PeerManager source tracking', () => {
    let pm: PeerManager;

    beforeEach(() => {
        rmSync(PEERS_FILE, { force: true });
        pm = new PeerManager({
            nodeId: 'self-node',
            url: 'https://self.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 0,
            tasksHandled: 0,
            source: 'http-gossip',
        });
    });

    it('registerPeer defaults to http-gossip source', () => {
        pm.registerPeer('peer-a', 'https://peer-a.example.com', ['llama3.2:3b']);
        const peers = pm.getAllPeers();
        expect(peers).toHaveLength(1);
        expect(peers[0].source).toBe('http-gossip');
    });

    it('registerPeer accepts an explicit source', () => {
        pm.registerPeer('peer-b', 'https://peer-b.example.com', ['llama3.2:3b'], 'p2p-mesh');
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('p2p-mesh');
    });

    it('does not overwrite self', () => {
        pm.registerPeer('self-node', 'https://should-not-register.example.com', []);
        expect(pm.getAllPeers()).toHaveLength(0);
    });

    it('receiveHeartbeat preserves an existing p2p-mesh source rather than downgrading to http-gossip', () => {
        pm.registerPeer('peer-c', 'https://peer-c.example.com', ['llama3.2:3b'], 'p2p-mesh');
        pm.receiveHeartbeat({
            nodeId: 'peer-c',
            url: 'https://peer-c.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 100,
            tasksHandled: 5,
        });
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('p2p-mesh');
    });

    it('receiveHeartbeat from a genuinely new peer records http-gossip', () => {
        pm.receiveHeartbeat({
            nodeId: 'peer-d',
            url: 'https://peer-d.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 100,
            tasksHandled: 5,
        });
        const peers = pm.getAllPeers();
        expect(peers[0].source).toBe('http-gossip');
    });
});

describe('PeerManager quality scoring', () => {
    let pm: PeerManager;

    beforeEach(() => {
        rmSync(PEERS_FILE, { force: true });
        pm = new PeerManager({
            nodeId: 'self-node',
            url: 'https://self.example.com',
            capabilities: ['llama3.2:3b'],
            version: '3.5.0',
            cpuCores: 4,
            ramGb: 8,
            uptime: 0,
            tasksHandled: 0,
            source: 'http-gossip',
        });
        // Seed a peer with a verified latency so getBestPeer() considers it
        pm.registerPeer('peer-q', 'https://peer-q.example.com', ['llama3.2:3b']);
        // Simulate a successful ping to get latencyMs below UNVERIFIED_LATENCY_MS
        const peer = pm.getAllPeers().find(p => p.nodeId === 'peer-q')!;
        peer.latencyMs = 100;
    });

    it('fresh peer (< 5 attempts) is not penalized regardless of failures', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-q'); // still selected — too few attempts to penalize
    });

    it('peer with 5+ attempts and >30% failure rate gets quality penalty but stays selectable', () => {
        // 3 failures + 2 successes = 60% failure rate → -500 penalty
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', true);
        pm.recordOutcome('peer-q', true);
        // Add a second peer with no quality history to confirm penalized peer loses in head-to-head
        pm.registerPeer('peer-r', 'https://peer-r.example.com', ['llama3.2:3b']);
        const peerR = pm.getAllPeers().find(p => p.nodeId === 'peer-r')!;
        peerR.latencyMs = 100; // same latency, so quality penalty is the deciding factor
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-r'); // unpenalized peer wins
    });

    it('peer with 3 consecutive failures is excluded from getBestPeer results', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best).toBeNull();
    });

    it('successful response resets consecutiveFails to 0 and allows re-selection', () => {
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        expect(pm.getBestPeer('llama3.2:3b')).toBeNull();
        pm.recordOutcome('peer-q', true); // recovers
        expect(pm.getBestPeer('llama3.2:3b')?.nodeId).toBe('peer-q');
    });

    it('quality state is per-nodeId and does not affect other peers', () => {
        pm.registerPeer('peer-s', 'https://peer-s.example.com', ['llama3.2:3b']);
        const peerS = pm.getAllPeers().find(p => p.nodeId === 'peer-s')!;
        peerS.latencyMs = 100;
        // Poison peer-q, peer-s should be unaffected
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        pm.recordOutcome('peer-q', false);
        const best = pm.getBestPeer('llama3.2:3b');
        expect(best?.nodeId).toBe('peer-s');
    });
});
