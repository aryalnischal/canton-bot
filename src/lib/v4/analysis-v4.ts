
import type { CoinglassData } from "../../services/coinglass-mock.ts";
import type { OnChainMetrics } from "../../services/on-chain-mock.ts";


// V4 SUPER BOT CONFIG (Python Parity)
const FUNDING_LONG_THRESH = 0.05;   // 5% annualized (Bullish bias if exceeded?) -> Python Logic is: if funding < -0.05 (Neg) -> Long Arb.
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
    };
    reasons: string[];
}

export function generateV4Signal(
    candles: { c: number, v: number }[],
    orderbook: { bids: [string, string][], asks: [string, string][] } | null,
    coinglass: CoinglassData,
    onChain: OnChainMetrics, // [NEW] On-Chain Data
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

    // 2. ENSEMBLE MODELING (Super Bot Upgrade)
    // ----------------------------------------

    // A. Neural Score (Sigmoid MLP Emulation)
    let rawScore = 0;
    // Bullish Weights
    if (rsi < 35) rawScore += 0.2;
    if (volSpike) rawScore += 0.1;
    if (liqRatio > 3.0) rawScore += 0.2;
    if (obImbalance > 0.2) rawScore += 0.15;
    if (maxPainDist > 0.02) rawScore += 0.1;
    if (trendGuard > 0) rawScore += 0.1;
    // Funding Arb: If shorts pay longs (negative funding), boost long score
    if (fundingRate < -0.01) rawScore += 0.15;

    // Bearish Weights
    if (rsi > 65) rawScore -= 0.2;
    if (liqRatio < 0.3) rawScore -= 0.2;
    if (obImbalance < -0.2) rawScore -= 0.15;
    if (maxPainDist < -0.02) rawScore -= 0.1;
    if (trendGuard < 0) rawScore -= 0.1;
    if (fundingRate > 0.01) rawScore -= 0.15;

    const neuralScore = 1 / (1 + Math.exp(-rawScore * 3));

    // B. Heuristic Tree Score (Gradient Boosting Emulation)
    // Rules-based decision tree for sharp edges
    let treeScore = 0.5; // Neutral start

    // "Golden Setup": Trend + Flush + Funding
    if (trendGuard > 0 && rsi < 40 && fundingRate < 0) treeScore = 0.9;
    // "Death Setup": Downtrend + Pump + Funding High
    else if (trendGuard < 0 && rsi > 60 && fundingRate > 0) treeScore = 0.1;
    // "Chop": Low Vol + Neutral RSI
    else if (atr / currentPrice < 0.005 && rsi > 40 && rsi < 60) treeScore = 0.5;
    else treeScore = neuralScore; // Fallback to neural if no specific leaf hit

    // C. Ensemble Average
    const finalScore = (neuralScore + treeScore) / 2;


    // 3. Dynamic Leverage & Risk (Python: lev = min(15, 15 / (1 + atr*10)))
    const atrPct = atr / currentPrice;

    // Python Vol Threshold Check
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

    // funding_arbitrage (Python Add-On 5)
    // if funding < FUNDING_SHORT_THRESH (-0.05) -> LONG (Shorts paying massive fees to Longs)
    let fundingSignal = 'NEUTRAL';
    if (fundingRate < FUNDING_SHORT_THRESH) fundingSignal = 'BUY';
    else if (fundingRate > FUNDING_LONG_THRESH) fundingSignal = 'SELL';

    if (finalScore > 0.6 || fundingSignal === 'BUY') {
        // Bullish Signal
        if (!onChain.isBullish && finalScore < 0.85 && fundingSignal !== 'BUY') {
            isBlocked = true;
            blockReason = "On-Chain Bearish";
        } else {
            action = 'BUY';
        }
    } else if (finalScore < 0.4 || fundingSignal === 'SELL') {
        // Bearish Signal
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
        if (fundingSignal !== 'NEUTRAL') reasons.push(`FundArb ${fundingSignal}`);
    }

    return {
        action,
        confidence,
        leverage: Math.floor(dynLev),
        score: finalScore,
        features: {
            rsi, volSpike, liqRatio, oiChange: coinglass.oiChangePercent, funding: fundingRate, imbalance: obImbalance, macdCross: macdScore, maxPainDist, atr, trendGuard, onChainBullish: onChain.isBullish
        },
        reasons
    };
}

export function calculateATR(candles: { c: number, v: number, h?: number, l?: number }[], period: number) {
    if (candles[0]?.h && candles[0]?.l) {
        // Proper ATR using True Range
        const trs: number[] = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].h!;
            const low = candles[i].l!;
            const prevClose = candles[i - 1].c;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trs.push(tr);
        }
        if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
        // Average of last `period` TRs
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }
    // Fallback: Standard Deviation proxy when no h/l
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
