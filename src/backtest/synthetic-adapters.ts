
import { ExchangeMetric } from "../lib/types";
// Mock types are sufficient, importing just for interface
import { CoinglassData } from "../services/coinglass";
import { OnChainMetrics } from "../services/on-chain";

// BACKTESTING ADAPTER
// Approximates Intelligence Data from pure Price/Volume when real history is missing.

export function synthesizeHistoricalData(
    candles: { c: number, v: number, h: number, l: number }[],
    index: number
) {
    // Need at least 50 candles for context
    if (index < 50) return null;

    const current = candles[index];
    const prev = candles[index - 1];

    // 1. Synthetic Whale Score
    // Logic: Volume Spikes + Price Hold = Whale Accumulation
    // Logic: Volume Spikes + Price Drop = Whale Dumping
    const volAvg = candles.slice(index - 20, index).reduce((a, b) => a + b.v, 0) / 20;
    const volRatio = current.v / volAvg;
    const priceChange = (current.c - prev.c) / prev.c;

    let whaleScore = 0.5; // Neutral
    let netFlow = 0;

    if (volRatio > 2.0) {
        if (priceChange > 0) {
            whaleScore = 0.8; // High Buying Volume
            netFlow = 100_000_000; // Simulated Inflow
        } else {
            whaleScore = 0.2; // High Selling Volume
            netFlow = -100_000_000; // Simulated Outflow
        }
    }

    // 2. Synthetic Max Pain
    // Logic: Uses 50-period SMA as a "Magnet" proxy
    const sma50 = candles.slice(index - 50, index).reduce((a, b) => a + b.c, 0) / 50;

    // 3. Synthetic Coinglass
    // Logic: RSI divergence proxy? Or just random noise + trend
    // We'll assume Funding follows Trend (High RSI = High Funding)
    const gains = [];
    const losses = [];
    for (let i = index - 14; i < index; i++) {
        const delta = candles[i].c - candles[i - 1].c;
        if (delta > 0) gains.push(delta); else losses.push(Math.abs(delta));
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
    const rs = avgGain / (avgLoss || 1);
    const rsi = 100 - (100 / (1 + rs));

    const fundingRate = (rsi > 70) ? 0.0004 : (rsi < 30 ? -0.0004 : 0.0001);

    return {
        onChain: {
            isBullish: whaleScore > 0.6,
            isBearish: whaleScore < 0.4,
            netFlow,
            whaleScore,
            tvlChange: 0,
            btcInflow: 0,
            usdcInflow: 0
        } as OnChainMetrics,
        coinglass: {
            longShortRatio: rsi > 50 ? 1.2 : 0.8,
            openInterestChange: volRatio > 1.5 ? 5 : -1,
            topTraderLsr: 1,
            longLiq: 0,
            shortLiq: 0,
            oiChangePercent: 0,
            topTraderLSR: rsi > 50 ? 1.1 : 0.9,
            takerBuySellRatio: priceChange > 0 ? 1.1 : 0.9,
            fundingRate: 0,
            oiTotal: 0,
            smartMoneyBias: 0,
            liquidationPressure: 0
        } as CoinglassData,
        maxPain: sma50,
        fundingRate
    };
}
