/**
 * ═══════════════════════════════════════════════════════════════
 * GSTD Node — Real-time Event Bus (WebSocket + EventEmitter)
 * 
 * Inspired by OpenClaw's Gateway WS control plane, but built for
 * the decentralized GSTD network with DeFi integration.
 * 
 * Features:
 *  - WebSocket server for real-time push to dashboards/clients
 *  - EventEmitter for internal module communication
 *  - Topic-based subscriptions (node.*, app.*, wallet.*, chat.*)
 *  - Auto-heartbeat to keep connections alive
 *  - Connection tracking with metadata
 * ═══════════════════════════════════════════════════════════════
 */

import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';

export interface EventPayload {
    topic: string;
    event: string;
    data: any;
    timestamp: string;
    nodeId?: string;
}

interface WSClient {
    ws: WebSocket;
    id: string;
    subscriptions: Set<string>;
    connectedAt: Date;
    lastPing: Date;
    metadata: Record<string, any>;
}

export class NodeEventBus extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private clients = new Map<string, WSClient>();
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private eventLog: EventPayload[] = [];
    private maxLogSize = 500;
    private nodeId: string;

    constructor(nodeId: string) {
        super();
        this.setMaxListeners(100);
        this.nodeId = nodeId;
    }

    /** Attach WS server to existing HTTP server */
    attachToServer(server: Server, path = '/ws') {
        this.wss = new WebSocketServer({ server, path });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const client: WSClient = {
                ws,
                id: clientId,
                subscriptions: new Set(['*']), // subscribe to all by default
                connectedAt: new Date(),
                lastPing: new Date(),
                metadata: { ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'] },
            };
            this.clients.set(clientId, client);
            this.emit('ws:connect', { clientId, total: this.clients.size });

            // Send welcome
            this.sendToClient(client, {
                topic: 'system',
                event: 'connected',
                data: { clientId, nodeId: this.nodeId, time: new Date().toISOString() },
                timestamp: new Date().toISOString(),
            });

            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    this.handleClientMessage(client, msg);
                } catch (_) {}
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                this.emit('ws:disconnect', { clientId, total: this.clients.size });
            });

            ws.on('pong', () => { client.lastPing = new Date(); });
        });

        // Heartbeat every 30s
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            this.clients.forEach((client, id) => {
                if (now - client.lastPing.getTime() > 60000) {
                    client.ws.terminate();
                    this.clients.delete(id);
                    return;
                }
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.ping();
                }
            });
        }, 30000);

        console.log(`  📡 Event Bus: WebSocket server ready at ${path}`);
    }

    /** Handle incoming client messages */
    private handleClientMessage(client: WSClient, msg: any) {
        switch (msg.type) {
            case 'subscribe':
                (msg.topics || []).forEach((t: string) => client.subscriptions.add(t));
                this.sendToClient(client, {
                    topic: 'system', event: 'subscribed',
                    data: { topics: Array.from(client.subscriptions) },
                    timestamp: new Date().toISOString(),
                });
                break;
            case 'unsubscribe':
                (msg.topics || []).forEach((t: string) => client.subscriptions.delete(t));
                break;
            case 'ping':
                this.sendToClient(client, {
                    topic: 'system', event: 'pong',
                    data: { time: new Date().toISOString() },
                    timestamp: new Date().toISOString(),
                });
                break;
        }
    }

    /** Broadcast event to all matching subscribers */
    broadcast(topic: string, event: string, data: any) {
        const payload: EventPayload = {
            topic, event, data,
            timestamp: new Date().toISOString(),
            nodeId: this.nodeId,
        };

        // Log event
        this.eventLog.push(payload);
        if (this.eventLog.length > this.maxLogSize) {
            this.eventLog = this.eventLog.slice(-this.maxLogSize);
        }

        // Emit internally
        this.emit(`${topic}:${event}`, data);
        this.emit('event', payload);

        // Push to WebSocket clients
        this.clients.forEach((client) => {
            if (client.ws.readyState !== WebSocket.OPEN) return;
            if (client.subscriptions.has('*') || client.subscriptions.has(topic) ||
                client.subscriptions.has(`${topic}:${event}`)) {
                this.sendToClient(client, payload);
            }
        });
    }

    private sendToClient(client: WSClient, payload: EventPayload) {
        try {
            client.ws.send(JSON.stringify(payload));
        } catch (_) {}
    }

    /** Get event log for debugging */
    getEventLog(limit = 50): EventPayload[] {
        return this.eventLog.slice(-limit);
    }

    /** Get connected clients info */
    getClients(): { id: string; subscriptions: string[]; connectedAt: string }[] {
        return Array.from(this.clients.values()).map(c => ({
            id: c.id,
            subscriptions: Array.from(c.subscriptions),
            connectedAt: c.connectedAt.toISOString(),
        }));
    }

    getClientCount(): number { return this.clients.size; }

    destroy() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.clients.forEach(c => c.ws.terminate());
        this.clients.clear();
        this.wss?.close();
    }
}
