
import type { CoinglassData } from "../../services/coinglass.ts";
import type { OnChainMetrics } from "../../services/on-chain.ts";


// V4 SUPER BOT CONFIG (Python Parity + CoinGlass Intelligence)
const FUNDING_LONG_THRESH = 0.05;
const FUNDING_SHORT_THRESH = -0.05;
const VOL_THRESHOLD = 0.03;         // ATR/Price Ratio
const TRAIL_DISTANCE = 0.015;       // 1.5% Trailing Stop

export interface V4Signal {
    action: 'BUY' | 'SELL' | 'NEUTRAL';
    confidence: number; // 0-100
    leverage: number;   // Dynamic 1x-15x
    score: number;      // Final Ensemble Score (0.0 - 1.0)
    features: {
        rsi: number;
        volSpike: number;
        liqRatio: number;
        oiChange: number;
        funding: number;
        imbalance: number;
        macdCross: number;
        maxPainDist: number;
        atr: number;
        trendGuard: number;
        onChainBullish: boolean;
        // NEW CoinGlass intelligence
        smartMoneyBias: number;
        liquidationPressure: number;
        topTraderLSR: number;
        takerBuySellRatio: number;
    };
    reasons: string[];
}

export function generateV4Signal(
    candles: { c: number, v: number }[],
    orderbook: { bids: [string, string][], asks: [string, string][] } | null,
    coinglass: CoinglassData,
    onChain: OnChainMetrics,
    maxPainPrice: number,
    fundingRate: number
): V4Signal {

    const closes = candles.map(c => c.c);
    const volumes = candles.map(c => c.v);
    const currentPrice = closes[closes.length - 1];

    if (closes.length < 50) {
        return { action: 'NEUTRAL', confidence: 0, leverage: 1, score: 0, features: {} as any, reasons: ["Not enough data"] };
    }

    // 1. Feature Engineering
    // ----------------------
    const rsi = calculateRSI(closes);

    // Vol Spike (> 1.5x of SMA20)
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volSpike = volumes[volumes.length - 1] > (avgVol20 * 1.5) ? 1 : 0;

    const liqRatio = coinglass.longLiq / (coinglass.shortLiq + 1);

    let obImbalance = 0;
    if (orderbook && (orderbook as any).levels) {
        const wsOB = orderbook as any;
        const bids = wsOB.levels[0].slice(0, 10).reduce((sum: number, lvl: any) => sum + parseFloat(lvl.sz), 0);
        const asks = wsOB.levels[1].slice(0, 10).reduce((sum: number, lvl: any) => sum + parseFloat(lvl.sz), 0);
        obImbalance = (bids - asks) / (bids + asks + 0.0001);
    } else if (orderbook && orderbook.bids) {
        const bids = orderbook.bids.slice(0, 10).reduce((sum, lvl) => sum + parseFloat(lvl[1]), 0);
        const asks = orderbook.asks.slice(0, 10).reduce((sum, lvl) => sum + parseFloat(lvl[1]), 0);
        obImbalance = (bids - asks) / (bids + asks + 0.0001);
    }

    const sma12 = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
    const sma26 = closes.slice(-26).reduce((a, b) => a + b, 0) / 26;
    const macdVal = sma12 - sma26;
    const macdScore = macdVal > 0 ? 1 : -1;

    const maxPainDist = (maxPainPrice - currentPrice) / currentPrice;
    const atr = calculateATR(candles, 14);

    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const trendGuard = currentPrice > sma50 ? 1 : -1;

    // =============================================
    // 2. ENSEMBLE MODELING (CoinGlass-Enhanced)
    // =============================================

    // A. Neural Score (Sigmoid MLP Emulation)
    let rawScore = 0;

    // --- Technical Signals (weight: 0.40 total) ---
    if (rsi < 35) rawScore += 0.15;
    if (rsi > 65) rawScore -= 0.15;
    if (volSpike) rawScore += 0.05;
    if (obImbalance > 0.2) rawScore += 0.1;
    if (obImbalance < -0.2) rawScore -= 0.1;
    if (trendGuard > 0) rawScore += 0.05;
    if (trendGuard < 0) rawScore -= 0.05;
    if (maxPainDist > 0.02) rawScore += 0.05;
    if (maxPainDist < -0.02) rawScore -= 0.05;

    // --- CoinGlass Intelligence (weight: 0.40 total) ---

    // Smart Money Bias (pre-computed: top traders + taker aggression + OI)
    // This is the MOST important CoinGlass signal
    rawScore += coinglass.smartMoneyBias * 0.20;

    // Liquidation Pressure (negative = short squeeze imminent → bullish)
    // If mostly shorts are getting liquidated, more squeezing is likely
    rawScore -= coinglass.liquidationPressure * 0.10;

    // Top Trader vs Crowd Divergence (contrarian signal)
    // If top traders are positioned opposite to the crowd, follow smart money
    const crowdLong = coinglass.longShortRatio > 1.2;  // Crowd is heavily long
    const smartLong = coinglass.topTraderLSR > 1.1;    // Smart money is long
    if (crowdLong && !smartLong) {
        // Crowd long but smart money isn't → bearish contrarian
        rawScore -= 0.10;
    } else if (!crowdLong && smartLong) {
        // Crowd not long but smart money is → bullish contrarian (follow smart money)
        rawScore += 0.10;
    }

    // --- Funding Rate Signal (weight: 0.20 total) ---
    // Use CoinGlass OI-weighted funding (more accurate than single-exchange)
    const effectiveFR = coinglass.fundingRate || fundingRate;
    if (effectiveFR < -0.01) rawScore += 0.15;   // Shorts paying longs → long signal
    if (effectiveFR > 0.01) rawScore -= 0.15;    // Longs paying shorts → short signal
    // Extreme funding = contrarian
    if (effectiveFR > 0.05) rawScore -= 0.05;    // Extremely bullish funding → top signal
    if (effectiveFR < -0.05) rawScore += 0.05;   // Extremely bearish funding → bottom signal

    const neuralScore = 1 / (1 + Math.exp(-rawScore * 3));

    // B. Heuristic Tree Score (Pattern Recognition)
    let treeScore = 0.5;

    // "Golden Setup": Uptrend + Oversold + Smart Money Long + Negative Funding
    if (trendGuard > 0 && rsi < 40 && coinglass.smartMoneyBias > 0.2 && effectiveFR < 0) {
        treeScore = 0.95;
    }
    // "Smart Squeeze": Short squeeze setup (shorts liquidated + smart money long + crowd short)
    else if (coinglass.liquidationPressure < -0.3 && smartLong && !crowdLong) {
        treeScore = 0.85;
    }
    // "Death Setup": Downtrend + Overbought + Smart Money Short + Crowd Long
    else if (trendGuard < 0 && rsi > 60 && coinglass.smartMoneyBias < -0.2 && crowdLong) {
        treeScore = 0.1;
    }
    // "Long Squeeze": Longs getting crushed + smart money short
    else if (coinglass.liquidationPressure > 0.3 && !smartLong && crowdLong) {
        treeScore = 0.15;
    }
    // "Chop": Low Vol + Neutral RSI + No smart money conviction
    else if (atr / currentPrice < 0.005 && rsi > 40 && rsi < 60 && Math.abs(coinglass.smartMoneyBias) < 0.1) {
        treeScore = 0.5;
    }
    else {
        treeScore = neuralScore; // Fallback
    }

    // C. Ensemble Average
    const finalScore = (neuralScore + treeScore) / 2;


    // 3. Dynamic Leverage & Risk
    const atrPct = atr / currentPrice;

    if (atrPct > VOL_THRESHOLD) {
        return { action: 'NEUTRAL', confidence: 0, leverage: 1, score: 0, features: {} as any, reasons: ["High Volatility (ATR > 3%)"] };
    }

    const maxLevBase = 15;
    const dynLev = Math.min(maxLevBase, maxLevBase / (1 + atrPct * 10));

    // 4. Decision Logic
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    const confidence = Math.abs(finalScore - 0.5) * 200;

    // GATEKEEPER: On-Chain Filter
    let isBlocked = false;
    let blockReason = "";

    let fundingSignal = 'NEUTRAL';
    if (effectiveFR < FUNDING_SHORT_THRESH) fundingSignal = 'BUY';
    else if (effectiveFR > FUNDING_LONG_THRESH) fundingSignal = 'SELL';

    if (finalScore > 0.6 || fundingSignal === 'BUY') {
        if (!onChain.isBullish && finalScore < 0.85 && fundingSignal !== 'BUY') {
            isBlocked = true;
            blockReason = "On-Chain Bearish";
        } else {
            action = 'BUY';
        }
    } else if (finalScore < 0.4 || fundingSignal === 'SELL') {
        if (onChain.isBullish && finalScore > 0.15 && fundingSignal !== 'SELL') {
            isBlocked = true;
            blockReason = "On-Chain Bullish";
        } else {
            action = 'SELL';
        }
    }

    const reasons = [`Score: ${finalScore.toFixed(2)}`];
    if (isBlocked) {
        action = 'NEUTRAL';
        reasons.push(`⛔ ${blockReason}`);
    } else {
        reasons.push(`Liq: ${liqRatio.toFixed(1)}`);
        if (coinglass.smartMoneyBias !== 0) {
            reasons.push(`SmartMoney: ${coinglass.smartMoneyBias > 0 ? '🟢' : '🔴'}${coinglass.smartMoneyBias.toFixed(2)}`);
        }
        if (coinglass.liquidationPressure !== 0) {
            reasons.push(`LiqPressure: ${coinglass.liquidationPressure > 0 ? 'L-Squeeze' : 'S-Squeeze'}(${Math.abs(coinglass.liquidationPressure).toFixed(2)})`);
        }
        if (fundingSignal !== 'NEUTRAL') reasons.push(`FundArb ${fundingSignal}`);
    }

    return {
        action,
        confidence,
        leverage: Math.floor(dynLev),
        score: finalScore,
        features: {
            rsi, volSpike, liqRatio,
            oiChange: coinglass.oiChangePercent,
            funding: effectiveFR,
            imbalance: obImbalance,
            macdCross: macdScore,
            maxPainDist, atr, trendGuard,
            onChainBullish: onChain.isBullish,
            smartMoneyBias: coinglass.smartMoneyBias,
            liquidationPressure: coinglass.liquidationPressure,
            topTraderLSR: coinglass.topTraderLSR,
            takerBuySellRatio: coinglass.takerBuySellRatio
        },
        reasons
    };
}

export function calculateATR(candles: { c: number, v: number, h?: number, l?: number }[], period: number) {
    if (candles[0]?.h && candles[0]?.l) {
        const trs: number[] = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].h!;
            const low = candles[i].l!;
            const prevClose = candles[i - 1].c;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trs.push(tr);
        }
        if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }
    const closes = candles.map(c => c.c).slice(-period);
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    return Math.sqrt(variance);
}

function calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
        }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
