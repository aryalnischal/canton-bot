import { generateTradeSignal } from "../analysis";
import { generateV3Signal } from "../v3/analysis-v3";
import { generateV4Signal } from "../v4/analysis-v4";
import type { ExchangeMetric } from "../types.ts";
import type { CoinglassData } from "../../services/coinglass.ts";
import type { OnChainMetrics } from "../../services/on-chain.ts";

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

    // ===== BALANCED ENGINE WEIGHTING =====
    // V4 is important but V2 (trend) must always contribute
    const cgStrength = Math.abs(coinglass.smartMoneyBias);
    const v4Weight = cgStrength > 0.5 ? 0.40 : (cgStrength > 0.3 ? 0.35 : 0.30);
    const v3Weight = 0.20; // Liquidity (fixed)
    const v2Weight = 1.0 - v4Weight - v3Weight; // Remainder to V2 (trend): 40-50%
    // v4Weight: 30-40% | v3Weight: 20% | v2Weight: 40-50%

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

    // ADAPTIVE WEIGHTS: V4 gets 35-50% based on CoinGlass conviction
    const scoreV2 = getVal(v2.action) * v2Weight;
    const scoreV3 = getVal(v3.action) * v3Weight;  // 20% (Liquidity)
    const scoreV4 = getVal(v4.action) * v4Weight; // 35-50% (Neural+CG)

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
    const reasons: string[] = [];
    let vetoed = false;

    // === COINGLASS LIQUIDATION GUARD (Highest Priority) ===
    // Block trades going AGAINST active liquidation squeezes
    if (coinglass.liquidationPressure > 0.7 && rawScore > 0) {
        rawScore = 0; // BLOCK LONGS — longs are getting flushed
        vetoed = true;
        reasons.push(`🛡️ LIQ GUARD: Longs flushed ($${(coinglass.longLiq / 1e6).toFixed(1)}M) — blocking BUY`);
    }
    if (coinglass.liquidationPressure < -0.7 && rawScore < 0) {
        rawScore = 0; // BLOCK SHORTS — shorts are getting squeezed
        vetoed = true;
        reasons.push(`🛡️ LIQ GUARD: Shorts squeezed ($${(coinglass.shortLiq / 1e6).toFixed(1)}M) — blocking SELL`);
    }

    // === ON-CHAIN VETO ===
    if (onChain.isBearish && rawScore > 0.2) {
        rawScore = 0;
        vetoed = true;
        reasons.push("⛔ VETO: On-Chain Bearish blocks Longs");
    }
    if (onChain.isBullish && rawScore < -0.2) {
        rawScore = 0;
        vetoed = true;
        reasons.push("⛔ VETO: On-Chain Bullish blocks Shorts");
    }

    // 5. DETERMINE ACTION & LEVERAGE
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let leverage = 0;

    const absScore = Math.abs(rawScore);

    if (absScore < 0.15) {
        action = 'NEUTRAL';
        leverage = 0;
        reasons.push("Low Consensus");
    } else {
        action = rawScore > 0 ? 'BUY' : 'SELL';

        // DYNAMIC LEVERAGE SCALING
        // Default: 3x | High conviction: up to 10x max
        if (absScore >= 0.85) leverage = 10;      // UNANIMOUS → MAX (10x)
        else if (absScore >= 0.70) leverage = 7;  // STRONG → AGGRESSIVE
        else if (absScore >= 0.50) leverage = 5;  // MODERATE → STANDARD
        else leverage = 3;                        // DEFAULT → CONSERVATIVE

        // === FUNDING RATE LEVERAGE MODIFIER (Crowded Trade Protection) ===
        // If going LONG but funding is positive (longs crowded) → reduce leverage 25%
        if (action === 'BUY' && coinglass.fundingRate > 0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
            reasons.push(`📉 FR: Longs crowded (${(coinglass.fundingRate * 100).toFixed(3)}%), lev reduced`);
        }
        // If going SHORT but funding is negative (shorts crowded) → reduce leverage 25%
        if (action === 'SELL' && coinglass.fundingRate < -0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
            reasons.push(`📉 FR: Shorts crowded (${(coinglass.fundingRate * 100).toFixed(3)}%), lev reduced`);
        }
        // EXTREME funding → hard cap at 3x regardless
        if (Math.abs(coinglass.fundingRate) > 0.03) {
            leverage = Math.min(leverage, 3);
            reasons.push(`⚠️ Extreme FR (${(coinglass.fundingRate * 100).toFixed(3)}%): Lev capped 3x`);
        }
    }

    // 6. VOLATILITY GUARD (New Safety Layer)
    // If asset moved > 8% in 24h, it's "Volatile".
    // Rule: Must have > 0.60 Score to enter (Strict). Max Leverage 4x.
    const priceChange = Math.abs(metrics[0]?.priceChange24h || 0);
    if (priceChange > 8.0) {
        if (action !== 'NEUTRAL') {
            // STRICTER ENTRY
            if (Math.abs(rawScore) < 0.60) {
                action = 'NEUTRAL';
                leverage = 0;
                reasons.push(`⚠️ Volatile (${priceChange.toFixed(1)}%): Score < 0.60 (Safeguard)`);
            } else {
                // CAP LEVERAGE
                if (leverage > 4) {
                    leverage = 4;
                    reasons.push(`⚠️ Volatile (${priceChange.toFixed(1)}%): Lev Capped 4x`);
                }
                // WIDER TP
                reasons.push("🎯 Target: Wide (Vol Reg)");
            }
        }
    }

    // Capture individual reasons for context
    if (action !== 'NEUTRAL') {
        if (v2.action === action) reasons.push(`V2 Trend Aligns`);
        if (v3.action === action) reasons.push(`V3 Liquidity Aligns`);
        if (v4.action === action) reasons.push(`V4 Neural Aligns (${(v4Weight * 100).toFixed(0)}%w)`);
        if ((action === 'BUY' && onChain.isBullish) || (action === 'SELL' && onChain.isBearish)) reasons.push(`On-Chain Aligns`);
        if (coinglass.smartMoneyBias !== 0) reasons.push(`CG SmartMoney: ${coinglass.smartMoneyBias > 0 ? '🟢' : '🔴'}${coinglass.smartMoneyBias.toFixed(2)}`);

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
