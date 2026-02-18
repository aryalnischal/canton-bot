
// HISTORICAL PROXY SERVICE
// Simulates "Invisible" Data (Options/Liq) based on Price Action for Backtesting

import type { CoinglassData } from "./coinglass.ts";

export class HistoricalProxy {

    /**
     * Estimates "Max Pain" price for a past timeframe.
     * Logic: Options Market Makers generally hedge such that Max Pain trails price but anchors to consolidation zones.
     * Proxy: 20-Day Simple Moving Average (SMA) of 1h closes.
     */
    static estimateMaxPain(candles: any[], currentIndex: number): number {
        const lookback = 20 * 24 * 4; // 20 days * 24h * 4 (15m periods)
        if (currentIndex < lookback) return candles[currentIndex].c;

        let sum = 0;
        // Optimization: Sample every 4th candle (1h resolution) for speed
        let count = 0;
        for (let i = currentIndex - lookback; i < currentIndex; i += 4) {
            sum += candles[i].c;
            count++;
        }
        return sum / count;
    }

    /**
     * Estimates Liquidation Data.
     * Logic: 
     * - Big Crash (>3% drop in 1h) -> "Longs Flushed" -> Long/Short Ratio drops.
     * - Big Pump (>3% rise in 1h) -> "Shorts Flushed" -> Long/Short Ratio spikes.
     * - Consolidation -> Ratio trends to 1.0.
     */
    static estimateCoinglass(candles: any[], currentIndex: number): CoinglassData {
        const lookback = 4; // 1 Hour (15m * 4)
        if (currentIndex < lookback) {
            return { longLiq: 0, shortLiq: 0, oiChangePercent: 0, longShortRatio: 1.0, topTraderLSR: 1.0, takerBuySellRatio: 1.0, fundingRate: 0, oiTotal: 0, smartMoneyBias: 0, liquidationPressure: 0 };
        }

        const currentClose = candles[currentIndex].c;
        const pastClose = candles[currentIndex - lookback].c;
        const pctChange = (currentClose - pastClose) / pastClose;
        const vol = candles[currentIndex].v;

        let longLiq = 100000;
        let shortLiq = 100000;
        let lsRatio = 1.0;

        // CRASH SCENARIO
        if (pctChange < -0.03) {
            longLiq = 5000000 + (vol * 0.1); // High Long Liq
            lsRatio = 0.4; // Bearish Sentiment (After flush)
        }
        // PUMP SCENARIO
        else if (pctChange > 0.03) {
            shortLiq = 5000000 + (vol * 0.1); // High Short Liq
            lsRatio = 1.6; // Bullish Sentiment
        }

        return {
            longLiq,
            shortLiq,
            oiChangePercent: pctChange * 100,
            longShortRatio: lsRatio,
            topTraderLSR: lsRatio,
            takerBuySellRatio: pctChange > 0 ? 1.2 : 0.8,
            fundingRate: pctChange > 0.02 ? 0.01 : (pctChange < -0.02 ? -0.01 : 0),
            oiTotal: 0,
            smartMoneyBias: pctChange > 0.03 ? 0.3 : (pctChange < -0.03 ? -0.3 : 0),
            liquidationPressure: longLiq > shortLiq ? 0.5 : (shortLiq > longLiq ? -0.5 : 0)
        };
    }
}
