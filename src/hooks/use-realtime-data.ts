
"use client";

import { useState, useEffect } from "react";
import { fetchBinanceData, fetchAllAssetsBatch, SUPPORTED_ASSETS } from "@/lib/api";
import { ExchangeMetric } from "@/lib/types";
import { useRealTime } from "@/context/RealTimeContext";

export function useRealTimeData(interval: string = '1d') {
    const { marketData: socketData, subscribeTo } = useRealTime();
    const [baseData, setBaseData] = useState<Record<string, ExchangeMetric>>({});
    const [isLoading, setIsLoading] = useState(true);

    // 1. Initial Hydration & Polling (For Vol/High/Low Stats)
    useEffect(() => {
        // Subscribe Sockets
        subscribeTo(SUPPORTED_ASSETS);

        async function fetchBase() {
            // OPTIMIZED BATCH FETCH: 1 Call instead of N calls
            console.log("[Data] Fetching Batch Snapshot...");
            const updates = await fetchAllAssetsBatch(interval);

            // Ensure CC is present (even if offline)
            if (!updates['CCUSDT']) {
                updates['CCUSDT'] = {
                    symbol: 'CCUSDT', pair: 'CC/USDT', price: 0, exchange: 'OFFLINE',
                    priceChange24h: 0, volume24h: 0, openInterest: 0, fundingRate: 0, high24h: 0, low24h: 0
                } as ExchangeMetric;
            }

            setBaseData(prev => ({ ...prev, ...updates }));
            setIsLoading(false);
        }

        fetchBase();
        const poll = setInterval(fetchBase, 60000); // 1m Poll for Volume Stats

        return () => clearInterval(poll);
    }, [interval, subscribeTo]);

    // 2. Merge Base + Socket (Hyperliquid Logic)
    const mergedData: Record<string, ExchangeMetric> = { ...baseData };

    // Iterate Socket Data (e.g. "BTC", "ETH")
    Object.keys(socketData).forEach(socketSym => {
        // Hyperliquid sends "BTC". We map to "BTCUSDT".
        // If symbol is "CC", it might be "CCUSDT", unless synthesized.
        const binanceSym = socketSym === 'CC' ? 'CCUSDT' : socketSym + 'USDT';

        const socketUpdate = socketData[socketSym];
        const base = mergedData[binanceSym];

        if (socketUpdate && socketUpdate.price && base) {
            // Safe Open: If base.open is missing/zero, use current socket price (0% change)
            const open = (base.open && base.open > 0) ? base.open : socketUpdate.price;

            // Update Price Real-Time
            mergedData[binanceSym] = {
                ...base,
                price: socketUpdate.price,
                // Recalculate Change (Safe Division)
                priceChange24h: open > 0 ? ((socketUpdate.price - open) / open) * 100 : 0,
                // Ensure we pass the open price forward
                open: open
            };
        }
    });

    return { data: mergedData, isLoading };
}
