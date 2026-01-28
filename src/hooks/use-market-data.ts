"use client";

import { useState, useEffect } from "react";
import { fetchBinanceData, SUPPORTED_ASSETS } from "@/lib/api";
import { ExchangeMetric } from "@/lib/types";
import { MOCK_DATA } from "@/lib/data";

export function useMarketData(interval: string = '1d') {
    const [data, setData] = useState<Record<string, ExchangeMetric>>({});
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [isLoading, setIsLoading] = useState(true);

    // Poll for live data
    useEffect(() => {
        async function updateData() {
            const updates: Record<string, ExchangeMetric> = {};

            await Promise.all(SUPPORTED_ASSETS.map(async (symbol) => {
                // OPTIMIZED STRATEGY MAPPING (Based on 3-Week Verification)
                // BTC -> 1h (TenX Strategy)
                // LINK -> 15m (Scalp)
                // Others -> 4h (Swing)
                let activeInterval = interval;

                // If Request Interval is 'AUTO', apply optimized settings
                if (interval === 'AUTO') {
                    // BTC: 1h (Market Anchor - Slow & Steady)
                    if (symbol === 'BTCUSDT') activeInterval = '1h';
                    // ALL ALTS (ETH, SOL, ADA, AVAX, ZEC, CC, LINK): 15m (High Frequency)
                    else activeInterval = '15m';
                }

                const metric = await fetchBinanceData(symbol, activeInterval);
                if (metric.pair) {
                    updates[symbol] = { ...metric, activeInterval } as ExchangeMetric;
                }
            }));

            setData(prev => ({
                ...prev,
                ...updates
            }));
            setLastUpdated(new Date());
            setIsLoading(false);
        }

        // Initial fetch
        const init = async () => {
            setIsLoading(true);
            await updateData();
        };
        init();

        // Poll every 15 seconds (less frequent for klines)
        const pollInterval = setInterval(updateData, 15000);
        return () => clearInterval(pollInterval);
    }, [interval]);

    return { data, lastUpdated, isLoading };
}
