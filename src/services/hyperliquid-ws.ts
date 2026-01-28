
// src/services/hyperliquid-ws.ts
import WebSocket from 'ws';

export class HyperliquidWS {
    private ws: WebSocket | null = null;
    private subscriptions: Set<string> = new Set();
    private messageHandlers: ((data: any) => void)[] = [];
    private isConnected: boolean = false;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.connect();
    }

    private connect() {
        if (this.ws) return;

        console.log("🔌 Connecting to Hyperliquid WS...");
        this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

        this.ws.on('open', () => {
            console.log("✅ WS Connected");
            this.isConnected = true;
            this.resubscribe();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const parsed = JSON.parse(data.toString());
                this.messageHandlers.forEach(handler => handler(parsed));
            } catch (e) {
                console.error("WS Parse Error", e);
            }
        });

        this.ws.on('close', () => {
            console.warn("⚠️ WS Disconnected. Reconnecting in 3s...");
            this.ws = null;
            this.isConnected = false;
            this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        });

        this.ws.on('error', (err) => {
            console.error("WS Error:", err.message);
        });
    }

    public subscribeL2Book(coin: string) {
        const payload = {
            method: "subscribe",
            subscription: { type: "l2Book", coin }
        };
        this.send(payload);
        this.subscriptions.add(JSON.stringify(payload));
    }

    private send(payload: any) {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    private resubscribe() {
        this.subscriptions.forEach(payloadStr => {
            this.send(JSON.parse(payloadStr));
        });
    }

    public onMessage(handler: (data: any) => void) {
        this.messageHandlers.push(handler);
    }
}
