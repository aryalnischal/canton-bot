
import { generateTradeSignal } from "../analysis.ts";
import { generateV3Signal } from "../v3/analysis-v3.ts";
import { generateV4Signal } from "../v4/analysis-v4.ts";
import type { ExchangeMetric } from "../types.ts";
import type { CoinglassData } from "../../services/coinglass-mock.ts";
import type { OnChainMetrics } from "../../services/on-chain-mock.ts";

export interface V5Consensus {
    action: 'BUY' | 'SELL' | 'NEUTRAL';
    confidence: number;
    score: number;
    leverage: number;
    votes: {
        v2: 'BUY' | 'SELL' | 'NEUTRAL';
        v3: 'BUY' | 'SELL' | 'NEUTRAL';
        v4: 'BUY' | 'SELL' | 'NEUTRAL';
        onChain: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    };
    reasons: string[];
}

export function generateV5Consensus(
    metrics: ExchangeMetric[],
    candles15m: { c: number, v: number }[],
    orderbook: any,
    coinglass: CoinglassData,
    onChain: OnChainMetrics,
    maxPainPrice: number,
    fundingRate: number
): V5Consensus {

    // 1. GATHER VOTES

    // V2 (Trend Guard - Conservative)
    // Uses daily/4h metrics from 'metrics' array
    const v2 = generateTradeSignal(metrics);

    // V3 (Liquidity Sniper - Aggressive)
    const v3 = generateV3Signal(candles15m, orderbook);

    // V4 (Neural Brain - Probabilistic)
    const v4 = generateV4Signal(
        candles15m,
        orderbook,
        coinglass,
        onChain,
        maxPainPrice,
        fundingRate
    );

    // 2. NORMALIZE VOTES (-1, 0, 1)
    const getVal = (act: string) => act === 'BUY' ? 1 : (act === 'SELL' ? -1 : 0);

    const scoreV2 = getVal(v2.action) * 0.20; // 20% Weight (Trend)
    const scoreV3 = getVal(v3.action) * 0.30; // 30% Weight (Liquidity)
    const scoreV4 = getVal(v4.action) * 0.30; // 30% Weight (Neural)

    // On-Chain Score (V5 Element)
    let scoreOnChain = 0;
    if (onChain.isBullish) scoreOnChain = 0.20;
    else if (onChain.isBearish) scoreOnChain = -0.20;

    // Max Pain Magnet Score (V5.1)
    // Theory: Price gravitates TOWARDS Max Pain. 
    // If Price < MaxPain => Bullish Pull. If Price > MaxPain => Bearish Pull.
    let scoreMaxPain = 0;
    const currentPrice = metrics[0]?.price || candles15m[candles15m.length - 1]?.c || 0;

    if (currentPrice > 0 && maxPainPrice > 0) {
        const painDelta = (maxPainPrice - currentPrice) / currentPrice;
        // Tuning: 0.5% deviation required to trigger magnet
        if (painDelta > 0.005) scoreMaxPain = 0.10; // Pull UP
        else if (painDelta < -0.005) scoreMaxPain = -0.10; // Pull DOWN
    }

    // 3. CALCULATE CONSENSUS SCORE (-1.0 to 1.0)
    let rawScore = scoreV2 + scoreV3 + scoreV4 + scoreOnChain + scoreMaxPain;

    // 4. VETO POWER (Risk Management)
    // If On-Chain is RED, we cannot go Long regardless of others (unless it's a minimal score)
    const reasons: string[] = [];
    let vetoed = false;

    if (onChain.isBearish && rawScore > 0.2) {
        rawScore = 0; // VETO LONG
        vetoed = true;
        reasons.push("⛔ VETO: On-Chain Bearish blocks Longs");
    }
    if (onChain.isBullish && rawScore < -0.2) {
        rawScore = 0; // VETO SHORT
        vetoed = true;
        reasons.push("⛔ VETO: On-Chain Bullish blocks Shorts");
    }

    // 5. DETERMINE ACTION & LEVERAGE
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let leverage = 0;

    const absScore = Math.abs(rawScore);

    if (absScore < 0.25) {
        action = 'NEUTRAL';
        leverage = 0;
        reasons.push("Low Consensus");
    } else {
        action = rawScore > 0 ? 'BUY' : 'SELL';

        // DYNAMIC LEVERAGE SCALING (Updated for Frequency)
        if (absScore >= 0.85) leverage = 15;      // UNANIMOUS -> SNIPER STANDARD
        else if (absScore >= 0.70) leverage = 10; // STRONG -> AGGRESSIVE
        else if (absScore >= 0.45) leverage = 5;  // MODERATE -> STANDARD (Widened Range)
        else leverage = 3;                        // WEAK -> ACTIVE SCALP (Was 2x)
    }

    // Capture individual reasons for context
    if (action !== 'NEUTRAL') {
        if (v2.action === action) reasons.push(`V2 Trend Aligns`);
        if (v3.action === action) reasons.push(`V3 Liquidity Aligns`);
        if (v4.action === action) reasons.push(`V4 Neural Aligns`);
        if ((action === 'BUY' && onChain.isBullish) || (action === 'SELL' && onChain.isBearish)) reasons.push(`On-Chain Aligns`);

        if (scoreMaxPain > 0 && action === 'BUY') reasons.push(`🧲 Max Pain Magnet (Pull UP)`);
        if (scoreMaxPain < 0 && action === 'SELL') reasons.push(`🧲 Max Pain Magnet (Pull DOWN)`);

        // TP STRATEGY (Standard 15x)
        if (leverage >= 10) {
            reasons.push("🎯 TP: Scaled Exits (1.5% - 8%)");
        }
    }

    return {
        action,
        confidence: Math.round(absScore * 100),
        score: rawScore,
        leverage,
        votes: {
            v2: v2.action,
            v3: v3.action,
            v4: v4.action,
            onChain: onChain.isBullish ? 'BULLISH' : (onChain.isBearish ? 'BEARISH' : 'NEUTRAL')
        },
        reasons
    };
}
