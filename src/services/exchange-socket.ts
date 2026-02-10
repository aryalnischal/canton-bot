
import { ExchangeMetric } from "../lib/types";

// dYdX Socket Adapter
// Mocks the WebSocket interface via Polling for robustness during migration.
// In Phase 2: We can implement true dYdX Indexer Socket.

type MessageHandler = (data: Partial<ExchangeMetric>) => void;
type UserHandler = (data: any) => void;

class DydxSocketService {
    private subscribers: Set<MessageHandler> = new Set();
    private userSubscribers: Set<UserHandler> = new Set();
    private pollTimer: NodeJS.Timeout | null = null;
    private userPollTimer: NodeJS.Timeout | null = null;
    private isConnectedVal = false;
    private activeUserAddress: string | null = null;

    public connect() {
        if (this.isConnectedVal) return;

        console.log("[DydxSocket] Starting Poller...");
        this.isConnectedVal = true;
        this.startMarketPoll();
    }

    private startMarketPoll() {
        // Poll /api/v5/scan periodically to get fresh prices
        // Frequency: 5s
        this.pollTimer = setInterval(async () => {
            try {
                // Use the Scan API as source of truth for "All Markets"
                const res = await fetch('/api/v5/scan');
                const data = await res.json();

                if (data.success && data.markets) {
                    data.markets.forEach((m: any) => {
                        const update: Partial<ExchangeMetric> = {
                            symbol: m.symbol,
                            price: m.price,
                            funding: m.fundingRate,
                            change24h: m.priceChange24h,
                            timestamp: Date.now()
                        };
                        this.notifySubscribers(update);
                    });
                }
            } catch (e) {
                // Ignore poll errors
            }
        }, 5000);
    }

    public subscribe(dataCallback: MessageHandler) {
        this.subscribers.add(dataCallback);
        return () => this.subscribers.delete(dataCallback);
    }

    public subscribeUser(dataCallback: UserHandler) {
        this.userSubscribers.add(dataCallback);
        return () => this.userSubscribers.delete(dataCallback);
    }

    public subscribeTo(symbols: string[]) {
        // No-op for global scan
    }

    public subscribeToUserState(address: string) {
        this.activeUserAddress = address;
        // Start User Polling
        if (this.userPollTimer) clearInterval(this.userPollTimer);

        // Mock User Data Structure expected by Context:
        // { clearinghouseState: { marginSummary: { accountValue: "..." }, assetPositions: [...] } }

        this.userPollTimer = setInterval(async () => {
            try {
                // Use internal API or Execution Engine to fetch state ??
                // Actually, we can fetch from /api/wallet route if we updated it?
                // Or we call `DydxExecutionService.getAccountState()` via an API route.
                // Let's assume /api/trade allows GET for account info? 
                // Actually /api/trade GET returns "activeTrades" from DB.

                // Solution: We need a way to fetch dYdX account state on client.
                // Temporary: Just fake it or rely on `SignalScanner`'s own poll.
                // But `RealTimeContext` expects data here.

                // If we leave this blank, `equity` in UI might be stale.
                // Let's omit for now, as `SignalScanner` has its own wallet poller (Lines 197+ in SignalScanner.tsx).

            } catch (e) { }
        }, 10000);
    }

    private notifySubscribers(data: Partial<ExchangeMetric>) {
        this.subscribers.forEach(cb => cb(data));
    }

    private notifyUserSubscribers(data: any) {
        this.userSubscribers.forEach(cb => cb(data));
    }

    public disconnect() {
        this.isConnectedVal = false;
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.userPollTimer) clearInterval(this.userPollTimer);
    }
}

export const exchangeSocket = new DydxSocketService();
