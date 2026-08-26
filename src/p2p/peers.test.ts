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
