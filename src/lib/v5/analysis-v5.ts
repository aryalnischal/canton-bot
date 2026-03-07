import { generateTradeSignal } from "../analysis";
import { generateV3Signal } from "../v3/analysis-v3";
import { generateV4Signal } from "../v4/analysis-v4";
import { checkATRGate, get4HDirectionalBias, checkSovereignEntry, calculateATRExitLevels } from "../v6/analysis-v6";
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
    v6Intel: {
        atrGate: boolean;
        bias4h: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        sovereignBoost: number;
        sovereignEntry: string;
        atrExit?: {
            slDistance: number;
            tpDistance: number;
            trailDistance: number;
            slPct: number;
            tpPct: number;
            atr: number;
        };
    };
    reasons: string[];
}

export function generateV5Consensus(
    metrics: ExchangeMetric[],
    candles15m: { c: number, v: number, o?: number, h?: number, l?: number }[],
    orderbook: any,
    coinglass: CoinglassData,
    onChain: OnChainMetrics,
    maxPainPrice: number,
    fundingRate: number,
    candles4h?: { o: number, h: number, l: number, c: number, v: number }[]
): V5Consensus {

    const reasons: string[] = [];

    // ============================================================
    // V6 LAYER 1: ATR VOLATILITY GATE (Pre-filter — runs FIRST)
    // ============================================================
    // If volatility is below threshold, don't trade AT ALL.
    // This kills 40-60% of chop signals before any engine runs.
    const ohlcCandles15m = candles15m.map(c => ({
        o: (c as any).o || c.c,
        h: (c as any).h || c.c,
        l: (c as any).l || c.c,
        c: c.c,
        v: c.v
    }));

    const atrGate = checkATRGate(ohlcCandles15m);
    reasons.push(atrGate.reason);

    // Extract symbol name for asset-specific rules (Change 4: BTC pullback skip)
    const symbolName = metrics[0]?.pair || '';

    if (!atrGate.isOpen) {
        // Market is in chop — block ALL trades regardless of engine votes
        return {
            action: 'NEUTRAL',
            confidence: 0,
            score: 0,
            leverage: 0,
            votes: { v2: 'NEUTRAL', v3: 'NEUTRAL', v4: 'NEUTRAL', onChain: 'NEUTRAL' },
            v6Intel: { atrGate: false, bias4h: 'NEUTRAL', sovereignBoost: 0, sovereignEntry: 'NONE' },
            reasons
        };
    }

    // ============================================================
    // V6 LAYER 2: 4H DIRECTIONAL BIAS (Direction filter)
    // ============================================================
    const bias4h = get4HDirectionalBias(candles4h || []);
    reasons.push(bias4h.reason);

    // ===== REBALANCED 5-PILLAR WEIGHTING =====
    // V4 (CoinGlass) elevated: unique institutional data (smart money, liquidation heatmaps)
    // V2 reduced: SMA trend partially redundant with V6's EMA trend detection
    const V2_WEIGHT = 0.20;  // Trend / Macro (SMA, momentum) — reduced, V6 covers trend
    const V3_WEIGHT = 0.20;  // Liquidity / Orderbook (15m RSI, MACD, OB imbalance)
    const V4_WEIGHT = 0.30;  // Neural / CoinGlass (smart money, funding, ensemble) — elevated
    const LF_WEIGHT = 0.20;  // Liquidity Flush (liquidation pressure + max pain magnet)
    const OC_WEIGHT = 0.10;  // On-Chain (DeFi TVL trend)
    // Total: 1.00

    // 1. GATHER VOTES
    const v2 = generateTradeSignal(metrics);
    const v3 = generateV3Signal(candles15m, orderbook);
    const v4 = generateV4Signal(candles15m, orderbook, coinglass, onChain, maxPainPrice, fundingRate);

    // 2. NORMALIZE ENGINE VOTES (-1, 0, 1) × weight
    const getVal = (act: string) => act === 'BUY' ? 1 : (act === 'SELL' ? -1 : 0);

    const scoreV2 = getVal(v2.action) * V2_WEIGHT;
    const scoreV3 = getVal(v3.action) * V3_WEIGHT;
    const scoreV4 = getVal(v4.action) * V4_WEIGHT;

    // === PILLAR 4: LIQUIDITY FLUSH (0.20 weight) ===
    const currentPrice = metrics[0]?.price || candles15m[candles15m.length - 1]?.c || 0;
    let liqFlushRaw = 0;

    if (coinglass.liquidationPressure > 0.3) liqFlushRaw += 0.5;
    else if (coinglass.liquidationPressure > 0.15) liqFlushRaw += 0.25;
    if (coinglass.liquidationPressure < -0.3) liqFlushRaw -= 0.5;
    else if (coinglass.liquidationPressure < -0.15) liqFlushRaw -= 0.25;

    if (currentPrice > 0 && maxPainPrice > 0) {
        const painDelta = (maxPainPrice - currentPrice) / currentPrice;
        if (painDelta > 0.02) liqFlushRaw += 0.4;
        else if (painDelta > 0.01) liqFlushRaw += 0.25;
        else if (painDelta < -0.02) liqFlushRaw -= 0.4;
        else if (painDelta < -0.01) liqFlushRaw -= 0.25;
    }

    if (coinglass.liquidationPressure > 0.2 && maxPainPrice > currentPrice) liqFlushRaw += 0.2;
    if (coinglass.liquidationPressure < -0.2 && maxPainPrice < currentPrice) liqFlushRaw -= 0.2;

    const liqFlushClamped = Math.max(-1, Math.min(1, liqFlushRaw));
    const scoreLiqFlush = liqFlushClamped * LF_WEIGHT;

    // === PILLAR 5: ON-CHAIN (0.10 weight) ===
    let scoreOnChain = 0;
    if (onChain.isBullish) scoreOnChain = 1 * OC_WEIGHT;
    else if (onChain.isBearish) scoreOnChain = -1 * OC_WEIGHT;

    // 3. CALCULATE CONSENSUS SCORE (-1.0 to 1.0)
    let rawScore = scoreV2 + scoreV3 + scoreV4 + scoreLiqFlush + scoreOnChain;

    // ============================================================
    // V6 LAYER 2 (continued): 4H DIRECTIONAL FILTER
    // ============================================================
    // If consensus wants to go counter to the 4H trend → dampen or block
    if (bias4h.bias !== 'NEUTRAL') {
        const consensusDir = rawScore > 0 ? 'BUY' : rawScore < 0 ? 'SELL' : 'NEUTRAL';

        if ((consensusDir === 'BUY' && bias4h.bias === 'BEARISH') ||
            (consensusDir === 'SELL' && bias4h.bias === 'BULLISH')) {
            // Counter-trend: dampen by 60% (strong discouragement but not a hard block)
            rawScore *= 0.4;
            reasons.push(`🚫 4H Counter-Trend: ${consensusDir} vs 4H ${bias4h.bias} → score dampened 60%`);
        } else if (
            (consensusDir === 'BUY' && bias4h.bias === 'BULLISH') ||
            (consensusDir === 'SELL' && bias4h.bias === 'BEARISH')) {
            // Aligned with 4H trend → slight boost
            rawScore *= 1.15;
            rawScore = Math.max(-1, Math.min(1, rawScore)); // re-clamp
            reasons.push(`✅ 4H Trend Aligned: ${consensusDir} + 4H ${bias4h.bias} → +15% score boost`);
        }
    }

    // 4. VETO POWER (Risk Management)
    if (coinglass.liquidationPressure > 0.8 && rawScore < 0) {
        rawScore = 0;
        reasons.push(`🛡️ LIQ GUARD: Active long cascade ($${(coinglass.longLiq / 1e6).toFixed(1)}M) — blocking SELL`);
    }
    if (coinglass.liquidationPressure < -0.8 && rawScore > 0) {
        rawScore = 0;
        reasons.push(`🛡️ LIQ GUARD: Active short squeeze ($${(coinglass.shortLiq / 1e6).toFixed(1)}M) — blocking BUY`);
    }

    if (onChain.isBearish && rawScore > 0.35) {
        rawScore *= 0.5;
        reasons.push("⚠️ On-Chain Bearish dampens Longs");
    }
    if (onChain.isBullish && rawScore < -0.35) {
        rawScore *= 0.5;
        reasons.push("⚠️ On-Chain Bullish dampens Shorts");
    }

    // 5. DETERMINE ACTION & LEVERAGE
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let leverage = 0;
    let absScore = Math.abs(rawScore);

    // RAISED THRESHOLD: 0.15 (was 0.10)
    // The ATR gate + 4H filter prefilter chop, and the Sovereign entry gate
    // (below) ensures only precision entries pass. A higher consensus threshold
    // means only multi-engine agreement triggers trades.
    if (absScore < 0.15) {
        action = 'NEUTRAL';
        leverage = 0;
        reasons.push("Low Consensus");
    } else {
        action = rawScore > 0 ? 'BUY' : 'SELL';

        // Leverage set below after confidence is calculated
        leverage = 3; // temporary default

        // (Funding rate modifiers moved to after confidence calculation below)
        if (Math.abs(coinglass.fundingRate) > 0.03) {
            reasons.push(`⚠️ Extreme FR (${(coinglass.fundingRate * 100).toFixed(3)}%): Lev capped 3x`);
        } else if (action === 'BUY' && coinglass.fundingRate > 0.01) {
            reasons.push(`📉 FR: Longs crowded (${(coinglass.fundingRate * 100).toFixed(3)}%)`);
        } else if (action === 'SELL' && coinglass.fundingRate < -0.01) {
            reasons.push(`📉 FR: Shorts crowded (${(coinglass.fundingRate * 100).toFixed(3)}%)`);
        }
    }

    // 6. VOLATILITY GUARD
    const priceChange = Math.abs(metrics[0]?.priceChange24h || 0);
    if (priceChange > 8.0) {
        if (action !== 'NEUTRAL') {
            if (absScore < 0.55) {
                action = 'NEUTRAL';
                leverage = 0;
                reasons.push(`⚠️ Volatile (${priceChange.toFixed(1)}%): Score < 0.55 (Safeguard)`);
            } else {
                if (leverage > 4) {
                    leverage = 4;
                    reasons.push(`⚠️ Volatile (${priceChange.toFixed(1)}%): Lev Capped 4x`);
                }
                reasons.push("🎯 Target: Wide (Vol Reg)");
            }
        }
    }

    // ============================================================
    // V6 LAYER 3: SOVEREIGN ENTRY GATE + CONFIDENCE BOOST
    // ============================================================
    // CRITICAL: Only allow trades where Sovereign sees IMPULSE or PULLBACK.
    // Plain TREND entries (33% WR) are blocked. This is the single
    // highest-impact change from backtesting.
    const sovereign = checkSovereignEntry(ohlcCandles15m, action, symbolName);
    let confidenceBoost = 0;

    if (action !== 'NEUTRAL') {
        if (!sovereign.entryConfirmed) {
            // No precision entry pattern — block the trade
            action = 'NEUTRAL';
            leverage = 0;
            absScore = 0;
            reasons.push(sovereign.reason || '🚫 Sovereign: No IMPULSE/PULLBACK entry — blocked');
            if (sovereign.skipReason) reasons.push(`Skip: ${sovereign.skipReason}`);
        } else {
            // Sovereign confirmed — apply confidence boost
            confidenceBoost = sovereign.boostPct;
            reasons.push(sovereign.reason);
        }
    }

    // ============================================================
    // V6 LAYER 4: ATR EXIT INTELLIGENCE
    // ============================================================
    // Calculate dynamic SL/TP from both scripts' exit logic.
    // These are passed through the consensus output so the trade API can use them.
    let atrExit: any = undefined;
    if (action !== 'NEUTRAL') {
        const exitLevels = calculateATRExitLevels(ohlcCandles15m, action);
        atrExit = {
            slDistance: exitLevels.stopLossDistance,
            tpDistance: exitLevels.takeProfitDistance,
            trailDistance: exitLevels.trailingDistance,
            slPct: exitLevels.stopLossPct,
            tpPct: exitLevels.takeProfitPct,
            atr: exitLevels.atr
        };
        reasons.push(exitLevels.reason);

        // RSI exit warning (for active position management)
        if (exitLevels.rsiExitLong) reasons.push('⚠️ RSI < 45: Sovereign suggests closing LONG early');
        if (exitLevels.rsiExitShort) reasons.push('⚠️ RSI > 55: Sovereign suggests closing SHORT early');
    }

    // Capture vote reasons
    if (action !== 'NEUTRAL') {
        if (v2.action === action) reasons.push(`V2 Trend Aligns`);
        if (v3.action === action) reasons.push(`V3 Liquidity Aligns`);
        if (v4.action === action) reasons.push(`V4 Neural Aligns`);
        if (liqFlushClamped > 0.2 && action === 'BUY') reasons.push(`🌊 Liq Flush: Buy the Dip`);
        if (liqFlushClamped < -0.2 && action === 'SELL') reasons.push(`🌊 Liq Flush: Sell the Rip`);
        if ((action === 'BUY' && onChain.isBullish) || (action === 'SELL' && onChain.isBearish)) reasons.push(`On-Chain Aligns`);
        if (coinglass.smartMoneyBias !== 0) reasons.push(`CG SmartMoney: ${coinglass.smartMoneyBias > 0 ? '🟢' : '🔴'}${coinglass.smartMoneyBias.toFixed(2)}`);

        if (maxPainPrice > 0 && currentPrice > 0) {
            const painDelta = (maxPainPrice - currentPrice) / currentPrice;
            if (painDelta > 0.01 && action === 'BUY') reasons.push(`🧲 Max Pain Magnet (Pull UP ${(painDelta * 100).toFixed(1)}%)`);
            if (painDelta < -0.01 && action === 'SELL') reasons.push(`🧲 Max Pain Magnet (Pull DOWN ${(Math.abs(painDelta) * 100).toFixed(1)}%)`);
        }

        if (leverage >= 10) {
            reasons.push("🎯 TP: Scaled Exits (1.5% - 8%)");
        }
    }

    // CONFIDENCE FORMULA: base (from score) + Sovereign boost
    const baseConfidence = Math.round(Math.min(absScore * 110, 100));
    const finalConfidence = Math.min(baseConfidence + confidenceBoost, 100);

    // CONFIDENCE-BASED LEVERAGE TIERS
    // 45-55% → 3x (conservative), 55-65% → 5x (standard), 65%+ → 10x (max conviction)
    if (action !== 'NEUTRAL') {
        if (finalConfidence >= 65) leverage = 10;
        else if (finalConfidence >= 55) leverage = 5;
        else leverage = 3;

        // FUNDING RATE still caps leverage (safety override)
        if (action === 'BUY' && coinglass.fundingRate > 0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
        }
        if (action === 'SELL' && coinglass.fundingRate < -0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
        }
        if (Math.abs(coinglass.fundingRate) > 0.03) {
            leverage = Math.min(leverage, 3);
        }
        reasons.push(`⚡ Leverage: ${leverage}x (Conf: ${finalConfidence}%)`);
    }

    return {
        action,
        confidence: finalConfidence,
        score: rawScore,
        leverage,
        votes: {
            v2: v2.action,
            v3: v3.action,
            v4: v4.action,
            onChain: onChain.isBullish ? 'BULLISH' : (onChain.isBearish ? 'BEARISH' : 'NEUTRAL')
        },
        v6Intel: {
            atrGate: atrGate.isOpen,
            bias4h: bias4h.bias,
            sovereignBoost: confidenceBoost,
            sovereignEntry: sovereign.entryType,
            atrExit
        },
        reasons
    };
}
