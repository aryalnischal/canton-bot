
// src/lib/v3/analysis-v3.ts
// HYBRID V3 BRAIN (Grok Edition)
// Merges "Smart Money" Sweeps with "Multi-Factor" Validation

import { calculateRSI, calculateMACD } from '../indicators';

export interface V3Signal {
    action: 'BUY' | 'SELL' | 'NEUTRAL';
    confidence: number;
    score: number;
    reasons: string[];
    factors: {
        macd: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        rsi: number;
        obImbalance: number; // -1 to 1 (Positive = Bid/Call Heavy)
        volSurge: boolean;
    };
}

// ---------------- CORE LOGIC ---------------- //


export function generateV3Signal(
    candles: { c: number, v: number }[],
    orderbook: any // Bypassing strict check for 'levels' vs 'bids/asks' mismatch
): V3Signal {
    const closes = candles.map(c => c.c);
    const volumes = candles.map(c => c.v);

    const currentPrice = closes[closes.length - 1];

    // 1. MACD
    const { macd, signal, hist } = calculateMACD(closes);
    const macdStatus = hist > 0 ? 'BULLISH' : 'BEARISH';

    // 2. RSI
    const rsi = calculateRSI(closes, 14);

    // 3. OB Imbalance
    let obImbalance = 0;
    if (orderbook && orderbook.levels && orderbook.levels.length >= 2) {
        // HL WS Format: levels[0] = Bids, levels[1] = Asks
        // Each entry is { px, sz, n }
        const bids = orderbook.levels[0];
        const asks = orderbook.levels[1];

        // Sum top 10 levels
        const bidVol = bids.slice(0, 10).reduce((sum: number, lvl: any) => sum + parseFloat(lvl.sz), 0);
        const askVol = asks.slice(0, 10).reduce((sum: number, lvl: any) => sum + parseFloat(lvl.sz), 0);
        obImbalance = (bidVol - askVol) / (bidVol + askVol + 0.0001);
    }

    // 4. Volume Surge
    const avgVol = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const currentVol = volumes[volumes.length - 1];
    const isVolSurge = currentVol > avgVol * 2.0;

    const reasons: string[] = [];
    let score = 0;

    // --- SCORING ---

    // A. Trend (MACD)
    if (macdStatus === 'BULLISH') score += 2;
    else score -= 2;

    // B. Momentum (RSI)
    if (rsi < 30) {
        score += 3; // Oversold Bounce
        reasons.push(`RSI Oversold (${rsi.toFixed(0)})`);
    }
    if (rsi > 70) {
        score -= 3; // Overbought Top
        reasons.push(`RSI Overbought (${rsi.toFixed(0)})`);
    }

    // C. Order flow (Imbalance)
    if (Math.abs(obImbalance) > 0.2) {
        if (obImbalance > 0) {
            score += 2;
            reasons.push(`Bid Heavy (+${(obImbalance * 100).toFixed(0)}%)`);
        } else {
            score -= 2;
            reasons.push(`Ask Heavy (${(obImbalance * 100).toFixed(0)}%)`);
        }
    }

    // D. Volume Confirmation
    if (isVolSurge) {
        // Volume confirms the DIRECTION of the candle
        const priceChange = closes[closes.length - 1] - closes[closes.length - 2];
        if (priceChange > 0) {
            score += 1.5;
            reasons.push("Vol Surge (Bullish)");
        } else {
            score -= 1.5;
            reasons.push("Vol Surge (Bearish)");
        }
    }

    // --- DECISION ---
    let action: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';

    // Thresholds
    if (score >= 3.5) action = 'BUY';   // Was 5.5 — too restrictive, caused zero trades
    if (score <= -3.5) action = 'SELL'; // Was -4 — symmetric with BUY threshold

    return {
        action,
        confidence: Math.min(Math.abs(score) * 10, 100),
        score,
        reasons,
        factors: {
            macd: macdStatus,
            rsi,
            obImbalance,
            volSurge: isVolSurge
        }
    };
}
