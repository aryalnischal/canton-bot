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

    // ===== BALANCED 5-PILLAR WEIGHTING =====
    // Each engine gets a meaningful, balanced slice.
    // Liquidity Flush is now a PRIMARY directional signal, not just a veto.
    const V2_WEIGHT = 0.25;  // Trend / Macro (SMA, momentum)
    const V3_WEIGHT = 0.20;  // Liquidity / Orderbook (15m RSI, MACD, OB imbalance)
    const V4_WEIGHT = 0.25;  // Neural / CoinGlass (smart money, funding, ensemble)
    const LF_WEIGHT = 0.20;  // Liquidity Flush (liquidation pressure + max pain magnet)
    const OC_WEIGHT = 0.10;  // On-Chain (DeFi TVL trend)
    // Total: 1.00

    // 1. GATHER VOTES

    // V2 (Trend Guard - Conservative)
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

    // 2. NORMALIZE ENGINE VOTES (-1, 0, 1) × weight
    const getVal = (act: string) => act === 'BUY' ? 1 : (act === 'SELL' ? -1 : 0);

    const scoreV2 = getVal(v2.action) * V2_WEIGHT;
    const scoreV3 = getVal(v3.action) * V3_WEIGHT;
    const scoreV4 = getVal(v4.action) * V4_WEIGHT;

    // === PILLAR 4: LIQUIDITY FLUSH (0.20 weight) ===
    // Theory: Exchanges hunt liquidation clusters. Price magnetizes to max pain.
    // After a flush, the OPPOSITE direction is the trade (contrarian).
    const currentPrice = metrics[0]?.price || candles15m[candles15m.length - 1]?.c || 0;
    let liqFlushRaw = 0;

    // A. Liquidation Pressure → Contrarian signal
    //    Longs flushed (pressure > 0) → flush over → BUY the dip
    //    Shorts flushed (pressure < 0) → flush over → SELL the rip
    if (coinglass.liquidationPressure > 0.3) liqFlushRaw += 0.5;
    else if (coinglass.liquidationPressure > 0.15) liqFlushRaw += 0.25;

    if (coinglass.liquidationPressure < -0.3) liqFlushRaw -= 0.5;
    else if (coinglass.liquidationPressure < -0.15) liqFlushRaw -= 0.25;

    // B. Max Pain Magnet → Directional pull
    //    Price below max pain → gravitates UP (bullish)
    //    Price above max pain → gravitates DOWN (bearish)
    if (currentPrice > 0 && maxPainPrice > 0) {
        const painDelta = (maxPainPrice - currentPrice) / currentPrice;
        if (painDelta > 0.02) liqFlushRaw += 0.4;        // Strong pull UP
        else if (painDelta > 0.01) liqFlushRaw += 0.25;  // Moderate pull UP
        else if (painDelta < -0.02) liqFlushRaw -= 0.4;  // Strong pull DOWN
        else if (painDelta < -0.01) liqFlushRaw -= 0.25;  // Moderate pull DOWN
    }

    // C. Cross-validate: Flush + Max Pain aligned = bonus
    if (coinglass.liquidationPressure > 0.2 && maxPainPrice > currentPrice) {
        liqFlushRaw += 0.2; // Longs flushed + price below max pain = strong BUY
    }
    if (coinglass.liquidationPressure < -0.2 && maxPainPrice < currentPrice) {
        liqFlushRaw -= 0.2; // Shorts flushed + price above max pain = strong SELL
    }

    const liqFlushClamped = Math.max(-1, Math.min(1, liqFlushRaw));
    const scoreLiqFlush = liqFlushClamped * LF_WEIGHT;

    // === PILLAR 5: ON-CHAIN (0.10 weight) ===
    let scoreOnChain = 0;
    if (onChain.isBullish) scoreOnChain = 1 * OC_WEIGHT;
    else if (onChain.isBearish) scoreOnChain = -1 * OC_WEIGHT;

    // 3. CALCULATE CONSENSUS SCORE (-1.0 to 1.0)
    let rawScore = scoreV2 + scoreV3 + scoreV4 + scoreLiqFlush + scoreOnChain;

    // 4. VETO POWER (Risk Management — softened, only extreme cases)
    const reasons: string[] = [];
    let vetoed = false;

    // === COINGLASS LIQUIDATION GUARD (Extreme Only: >0.8) ===
    // Block trades going WITH an active liquidation cascade (not against — that's the flush signal)
    if (coinglass.liquidationPressure > 0.8 && rawScore < 0) {
        rawScore = 0; // Longs actively being flushed RIGHT NOW — don't short into the cascade
        vetoed = true;
        reasons.push(`🛡️ LIQ GUARD: Active long cascade ($${(coinglass.longLiq / 1e6).toFixed(1)}M) — blocking SELL`);
    }
    if (coinglass.liquidationPressure < -0.8 && rawScore > 0) {
        rawScore = 0; // Shorts actively being squeezed RIGHT NOW — don't long into the squeeze
        vetoed = true;
        reasons.push(`🛡️ LIQ GUARD: Active short squeeze ($${(coinglass.shortLiq / 1e6).toFixed(1)}M) — blocking BUY`);
    }

    // === ON-CHAIN VETO (only strong divergence) ===
    if (onChain.isBearish && rawScore > 0.35) {
        rawScore *= 0.5; // Dampen, don't zero
        reasons.push("⚠️ On-Chain Bearish dampens Longs");
    }
    if (onChain.isBullish && rawScore < -0.35) {
        rawScore *= 0.5;
        reasons.push("⚠️ On-Chain Bullish dampens Shorts");
    }

    // 5. DETERMINE ACTION & LEVERAGE
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let leverage = 0;

    const absScore = Math.abs(rawScore);

    if (absScore < 0.12) {
        action = 'NEUTRAL';
        leverage = 0;
        reasons.push("Low Consensus");
    } else {
        action = rawScore > 0 ? 'BUY' : 'SELL';

        // DYNAMIC LEVERAGE SCALING
        if (absScore >= 0.85) leverage = 10;      // UNANIMOUS → MAX
        else if (absScore >= 0.70) leverage = 7;  // STRONG → AGGRESSIVE
        else if (absScore >= 0.50) leverage = 5;  // MODERATE → STANDARD
        else leverage = 3;                        // DEFAULT → CONSERVATIVE

        // === FUNDING RATE LEVERAGE MODIFIER ===
        if (action === 'BUY' && coinglass.fundingRate > 0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
            reasons.push(`📉 FR: Longs crowded (${(coinglass.fundingRate * 100).toFixed(3)}%), lev reduced`);
        }
        if (action === 'SELL' && coinglass.fundingRate < -0.01) {
            leverage = Math.max(2, Math.ceil(leverage * 0.75));
            reasons.push(`📉 FR: Shorts crowded (${(coinglass.fundingRate * 100).toFixed(3)}%), lev reduced`);
        }
        if (Math.abs(coinglass.fundingRate) > 0.03) {
            leverage = Math.min(leverage, 3);
            reasons.push(`⚠️ Extreme FR (${(coinglass.fundingRate * 100).toFixed(3)}%): Lev capped 3x`);
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

    // Capture individual reasons for context
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

    return {
        action,
        confidence: Math.round(Math.min(absScore * 110, 100)),
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
