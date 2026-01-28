
import { ExchangeMetric } from "../lib/types";

// Hyperliquid WebSocket Endpoint
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

type MessageHandler = (data: Partial<ExchangeMetric>) => void;
type UserHandler = (data: any) => void;

class HyperliquidSocketService {
    private ws: WebSocket | null = null;
    private subscribers: Set<MessageHandler> = new Set();
    private userSubscribers: Set<UserHandler> = new Set(); // New: User Data Subscribers
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isExplicitlyClosed = false;
    private activeUserAddress: string | null = null; // Track address to re-sub on reconnect

    constructor() {
        this.connect = this.connect.bind(this);
        this.onMessage = this.onMessage.bind(this);
    }

    public connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.isExplicitlyClosed = false;
        console.log(`[Socket] Connecting to Hyperliquid (${WS_URL})...`);

        try {
            this.ws = new WebSocket(WS_URL);

            this.ws.onopen = () => {
                console.log("[Socket] Connected to Hyperliquid ✅");
                this.subscribeToAllMids();
                // Re-subscribe to User Data if address exists
                if (this.activeUserAddress) {
                    this.sendUserSubscription(this.activeUserAddress);
                }
            };

            this.ws.onclose = () => {
                console.log("[Socket] Disconnected ❌");
                this.ws = null;
                if (!this.isExplicitlyClosed) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (err) => {
                console.error("[Socket] Error:", err);
            };

            this.ws.onmessage = this.onMessage;

        } catch (e) {
            console.error("[Socket] Connection Failed:", e);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            console.log("[Socket] Attempting Reconnect...");
            this.connect();
        }, 3000);
    }

    // Market Data Subscription
    public subscribe(dataCallback: MessageHandler) {
        this.subscribers.add(dataCallback);
        return () => this.subscribers.delete(dataCallback);
    }

    // User Data Subscription (Positions/Orders)
    public subscribeUser(dataCallback: UserHandler) {
        this.userSubscribers.add(dataCallback);
        return () => this.userSubscribers.delete(dataCallback);
    }

    // Hyperliquid Specific: Subscribe to 'allMids' (Global Price Feed)
    private subscribeToAllMids() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const payload = {
            method: "subscribe",
            subscription: { type: "allMids" }
        };
        this.ws.send(JSON.stringify(payload));
        console.log("[Socket] Subscribed to 'allMids' 🔥");
    }

    // New: Subscribe to User Events (WebData2)
    public subscribeToUserState(address: string) {
        this.activeUserAddress = address; // Store for reconnect
        this.sendUserSubscription(address);
    }

    private sendUserSubscription(address: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const payload = {
            method: "subscribe",
            subscription: { type: "webData2", user: address }
        };
        this.ws.send(JSON.stringify(payload));
        console.log(`[Socket] Subscribed to User Data: ${address.slice(0, 6)}...`);
    }

    public subscribeTo(symbols: string[]) {
        // Hyperliquid 'allMids' covers everything.
        // Interface compatibility stub.
    }

    private onMessage(event: MessageEvent) {
        try {
            const msg = JSON.parse(event.data as string);

            // 1. Market Data (allMids)
            // { channel: "allMids", data: { "BTC": "65000.5", ... } }
            if (msg.channel === 'allMids' && msg.data) {
                Object.entries(msg.data).forEach(([coin, price]) => {
                    const update: Partial<ExchangeMetric> = {
                        symbol: coin,
                        price: parseFloat(price as string),
                        timestamp: Date.now()
                    };
                    this.notifySubscribers(update);
                });
            }

            // 2. User Data (webData2)
            // { channel: "webData2", data: { clearinghouseState: {...}, openOrders: [...] } }
            if (msg.channel === 'webData2' && msg.data) {
                this.notifyUserSubscribers(msg.data);
            }

        } catch (e) {
            console.error("[Socket] Parse Error", e);
        }
    }

    private notifySubscribers(data: Partial<ExchangeMetric>) {
        this.subscribers.forEach(cb => cb(data));
    }

    private notifyUserSubscribers(data: any) {
        this.userSubscribers.forEach(cb => cb(data));
    }

    public disconnect() {
        this.isExplicitlyClosed = true;
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Singleton Export
export const exchangeSocket = new HyperliquidSocketService();
