
import { useState, useEffect, useCallback } from 'react';

// Types
interface DydxTicker {
    symbol: string;
    price: number;
    change24h: number;
}

interface UseDydxWS {
    isConnected: boolean;
    lastPrice: Record<string, number>;
    subscribe: (symbols: string[]) => void;
}

export function useDydxWS(): UseDydxWS {
    const [isConnected, setIsConnected] = useState(false);
    const [lastPrice, setLastPrice] = useState<Record<string, number>>({});
    const [subs, setSubs] = useState<Set<string>>(new Set());

    // Effect: Poll our local API for latest prices (Proxy for WS)
    // Why? Browser->dYdX Indexer CORS might be an issue.
    // Ideally we assume SignalScanner polls every 15s via `useMarketData`.
    // But for "Real-Time" feel, we can poll a lightweight endpoint or rely on `api/v5/scan` cache.
    // For MVP Migration: We mock the WS interface but use polling under hood.

    useEffect(() => {
        setIsConnected(true);
        const interval = setInterval(async () => {
            if (subs.size === 0) return;

            // In a real app we'd fetch specific tickers. 
            // Here we rely on the main scanner updating properties.
            // Actually, let's just expose a setter so the Scanner can push updates *into* this hook?
            // No, the Scanner uses `useMarketData` (SWR/React Query).
            // This hook was for "Live Ticker Flash".

            // Let's implement a lightweight poll to dYdX public API for specific assets?
            // CORS likely blocks direct browser access to `indexer.dydx.trade`.
            // Solution: The hook manages state, but updates come from the `SignalScanner` refresh cycle mostly.

        }, 5000);

        return () => clearInterval(interval);
    }, [subs]);

    const subscribe = useCallback((symbols: string[]) => {
        setSubs(prev => {
            const next = new Set(prev);
            symbols.forEach(s => next.add(s));
            return next;
        });
    }, []);

    return {
        isConnected,
        lastPrice,
        subscribe
    };
}
