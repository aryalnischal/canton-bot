// src/lib/v6/analysis-v6.ts
// V6 GLOBAL INTELLIGENCE LAYER (v2 — Optimized)
// ================================================
// 3 layers + ATR Exit Intelligence + Sovereign Entry Gate:
//   1. ATR VOLATILITY GATE → Should we trade AT ALL?
//   2. 4H DIRECTIONAL BIAS → WHICH direction?
//   3. SOVEREIGN ENTRY GATE + BOOST → Is this a precision entry? +confidence
//   4. ATR EXIT INTELLIGENCE → Dynamic SL/TP from both scripts' exit logic

import { calculateEMA, calculateRSI } from '../indicators';

// ============================================================
//  LAYER 1: ATR VOLATILITY GATE
// ============================================================

export interface ATRGateResult {
    isOpen: boolean;
    atr: number;
    atrSma: number;
    ratio: number;
    reason: string;
}

function computeATR(candles: { h: number; l: number; c: number }[]): { trs: number[]; atr: number; atrSma: number; ratio: number } {
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        trs.push(Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - candles[i - 1].c),
            Math.abs(candles[i].l - candles[i - 1].c)
        ));
    }
    const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / Math.min(trs.length, 14);
    const atrSma = trs.slice(-20).reduce((a, b) => a + b, 0) / Math.min(trs.length, 20);
    const ratio = atrSma > 0 ? atr / atrSma : 1;
    return { trs, atr, atrSma, ratio };
}

export function checkATRGate(
    candles: { h: number; l: number; c: number }[]
): ATRGateResult {
    if (candles.length < 21) {
        return { isOpen: true, atr: 0, atrSma: 0, ratio: 1, reason: '⚠️ ATR Gate: Insufficient data — allowing trades' };
    }

    const { atr, atrSma, ratio } = computeATR(candles);
    const GATE_THRESHOLD = 1.05;
    const isOpen = ratio >= GATE_THRESHOLD;

    return {
        isOpen, atr, atrSma, ratio,
        reason: isOpen
            ? `🔓 ATR Gate OPEN: Volatility ${(ratio * 100).toFixed(0)}% of avg`
            : `🔒 ATR Gate CLOSED: Volatility ${(ratio * 100).toFixed(0)}% of avg — chop, no trades`
    };
}

// ============================================================
//  LAYER 2: 4H DIRECTIONAL BIAS (SulCrypto)
// ============================================================

export interface DirectionalBias {
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    strength: number;
    barsInTrend: number;
    reason: string;
}

export function get4HDirectionalBias(
    candles4h: { c: number }[]
): DirectionalBias {
    if (candles4h.length < 22) {
        return { bias: 'NEUTRAL', strength: 0, barsInTrend: 0, reason: '4H: Insufficient data for EMA(21)' };
    }

    const closes = candles4h.map(c => c.c);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const currentEma9 = ema9[ema9.length - 1];
    const currentEma21 = ema21[ema21.length - 1];

    const currentPrice = closes[closes.length - 1];
    const separation = currentPrice > 0 ? Math.abs(currentEma9 - currentEma21) / currentPrice : 0;
    const strength = Math.min(separation * 100, 1);

    let barsInTrend = 0;
    for (let i = ema9.length - 1; i >= 0; i--) {
        if ((ema9[i] > ema21[i]) === (currentEma9 > currentEma21)) barsInTrend++;
        else break;
    }

    if (currentEma9 > currentEma21) {
        return { bias: 'BULLISH', strength, barsInTrend,
            reason: `📐 4H BULLISH: EMA9 > EMA21 for ${barsInTrend} bars` };
    }
    if (currentEma9 < currentEma21) {
        return { bias: 'BEARISH', strength, barsInTrend,
            reason: `📐 4H BEARISH: EMA9 < EMA21 for ${barsInTrend} bars` };
    }
    return { bias: 'NEUTRAL', strength: 0, barsInTrend: 0, reason: '📐 4H NEUTRAL: EMAs converged' };
}

// ============================================================
//  LAYER 3: SOVEREIGN ENTRY GATE + CONFIDENCE BOOST
// ============================================================
// Two roles:
//   A. GATE: Only allow trades with IMPULSE or PULLBACK entries.
//      Plain TREND entries (33% WR) are blocked.
//   B. BOOST: Add confidence for precision entries.

export interface SovereignResult {
    // Gate
    entryConfirmed: boolean;   // true = Sovereign sees a valid entry pattern
    entryType: 'IMPULSE' | 'PULLBACK' | 'NONE';
    // Boost
    boostPct: number;           // 0-15, added to confidence %
    // Context
    trendAligned: boolean;
    rsi: number;
    reason: string;
    // Asset-specific rules
    skipReason?: string;        // If set, this signal should be skipped
}

export function checkSovereignEntry(
    candles15m: { o: number; h: number; l: number; c: number }[],
    consensusAction: 'BUY' | 'SELL' | 'NEUTRAL',
    symbol?: string
): SovereignResult {
    const noEntry: SovereignResult = {
        entryConfirmed: false, entryType: 'NONE', boostPct: 0,
        trendAligned: false, rsi: 50, reason: ''
    };

    if (consensusAction === 'NEUTRAL' || candles15m.length < 30) return noEntry;

    const closes = candles15m.map(c => c.c);
    const highs = candles15m.map(c => c.h);
    const lows = candles15m.map(c => c.l);

    const emaFastArr = calculateEMA(closes, 9);
    const emaSlowArr = calculateEMA(closes, 21);
    const emaFast = emaFastArr[emaFastArr.length - 1];
    const emaSlow = emaSlowArr[emaSlowArr.length - 1];
    const rsi = calculateRSI(closes, 14);

    const trendUp = emaFast > emaSlow;
    const trendDown = emaFast < emaSlow;
    const trendAligned =
        (consensusAction === 'BUY' && trendUp) ||
        (consensusAction === 'SELL' && trendDown);

    const lastIdx = candles15m.length - 1;
    const currentClose = closes[lastIdx];
    const currentHigh = highs[lastIdx];
    const currentLow = lows[lastIdx];
    const prevClose = closes[lastIdx - 1];

    // Impulse breakout detection
    const lookbackHighs = highs.slice(Math.max(0, lastIdx - 5), lastIdx);
    const lookbackLows = lows.slice(Math.max(0, lastIdx - 5), lastIdx);
    const highest5 = Math.max(...lookbackHighs);
    const lowest5 = Math.min(...lookbackLows);

    const impulseLong = consensusAction === 'BUY' && currentClose > highest5;
    const impulseShort = consensusAction === 'SELL' && currentClose < lowest5;

    // Pullback continuation (stricter RSI: 55/45 from backtest tuning)
    const pullLong = consensusAction === 'BUY' && trendUp && currentLow <= emaFast && rsi > 55 && currentClose > prevClose;
    const pullShort = consensusAction === 'SELL' && trendDown && currentHigh >= emaFast && rsi < 45 && currentClose < prevClose;

    // Determine entry type
    let entryType: 'IMPULSE' | 'PULLBACK' | 'NONE' = 'NONE';
    if (impulseLong || impulseShort) entryType = 'IMPULSE';
    else if (pullLong || pullShort) entryType = 'PULLBACK';

    if (entryType === 'NONE') {
        return { ...noEntry, trendAligned, rsi, reason: '🚫 Sovereign: No precision entry pattern — trade blocked' };
    }

    // CHANGE 4: Skip BTC pullbacks (20% WR in backtest)
    const sym = (symbol || '').toUpperCase();
    if (entryType === 'PULLBACK' && (sym.includes('BTC') || sym === 'BTC-USD')) {
        return {
            entryConfirmed: false, entryType: 'PULLBACK', boostPct: 0,
            trendAligned, rsi,
            reason: '🚫 Sovereign: BTC pullback skipped (20% WR)',
            skipReason: 'BTC_PULLBACK_SKIP'
        };
    }

    // Calculate confidence boost
    let boostPct = 0;
    let reason = '';

    if (entryType === 'IMPULSE') {
        boostPct = trendAligned ? 15 : 8;
        reason = `🚀 Sovereign IMPULSE${trendAligned ? ' + trend aligned' : ''} → +${boostPct}% confidence`;
    } else {
        boostPct = trendAligned ? 12 : 5;
        reason = `🔄 Sovereign PULLBACK (RSI ${rsi.toFixed(0)})${trendAligned ? ' + trend aligned' : ''} → +${boostPct}% confidence`;
    }

    return { entryConfirmed: true, entryType, boostPct, trendAligned, rsi, reason };
}

// ============================================================
//  LAYER 4: ATR EXIT INTELLIGENCE (from both scripts)
// ============================================================
// Combines Sovereign's ATR stop logic with SulCrypto's ATR TP + trailing.
//
// Sovereign exit: SL = entry - ATR * 1.5 (long), exit early if RSI < 45
// SulCrypto exit: SL = ATR * 2.0, TP = ATR * 3.0, trailing = ATR * 1.5
//
// We blend both: SL = ATR * 1.5, TP = ATR * 2.5, trailing = ATR * 1.5

export interface ATRExitLevels {
    stopLossDistance: number;   // $ distance from entry for SL
    takeProfitDistance: number; // $ distance from entry for TP
    trailingDistance: number;   // $ trailing stop distance
    stopLossPct: number;       // SL as % of price (for logging)
    takeProfitPct: number;     // TP as % of price (for logging)
    atr: number;               // raw ATR value
    rsiExitLong: boolean;      // Sovereign RSI exit: close long if RSI < 45
    rsiExitShort: boolean;     // Sovereign RSI exit: close short if RSI > 55
    reason: string;
}

export function calculateATRExitLevels(
    candles15m: { o: number; h: number; l: number; c: number }[],
    action: 'BUY' | 'SELL'
): ATRExitLevels {
    const defaultExit: ATRExitLevels = {
        stopLossDistance: 0, takeProfitDistance: 0, trailingDistance: 0,
        stopLossPct: 2.0, takeProfitPct: 3.0, atr: 0,
        rsiExitLong: false, rsiExitShort: false,
        reason: 'Using default fixed SL/TP (insufficient data for ATR)'
    };

    if (candles15m.length < 21) return defaultExit;

    const { atr } = computeATR(candles15m);
    const currentPrice = candles15m[candles15m.length - 1].c;
    if (atr <= 0 || currentPrice <= 0) return defaultExit;

    // Blended exit from both scripts:
    // SL = 1.5 × ATR (Sovereign's atr_stop distance)
    // TP = 2.5 × ATR (average of SulCrypto's 3.0 and Sovereign's ~2.0 implied R:R)
    // Trailing = 1.5 × ATR (SulCrypto's trailing stop)
    const SL_MULT = 1.5;
    const TP_MULT = 2.5;
    const TRAIL_MULT = 1.5;

    const slDist = atr * SL_MULT;
    const tpDist = atr * TP_MULT;
    const trailDist = atr * TRAIL_MULT;

    // Sovereign RSI exit check
    const closes = candles15m.map(c => c.c);
    const rsi = calculateRSI(closes, 14);
    const rsiExitLong = action === 'BUY' && rsi < 45;   // Sovereign: close long if RSI drops below 45
    const rsiExitShort = action === 'SELL' && rsi > 55; // Inverse for shorts

    const slPct = (slDist / currentPrice) * 100;
    const tpPct = (tpDist / currentPrice) * 100;

    return {
        stopLossDistance: slDist,
        takeProfitDistance: tpDist,
        trailingDistance: trailDist,
        stopLossPct: slPct,
        takeProfitPct: tpPct,
        atr,
        rsiExitLong,
        rsiExitShort,
        reason: `📊 ATR Exit: SL=${slPct.toFixed(2)}% ($${slDist.toFixed(2)}) | TP=${tpPct.toFixed(2)}% ($${tpDist.toFixed(2)}) | Trail=$${trailDist.toFixed(2)} | ATR=$${atr.toFixed(2)}`
    };
}
