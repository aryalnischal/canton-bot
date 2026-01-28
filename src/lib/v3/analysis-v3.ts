
// src/lib/v3/analysis-v3.ts
// HYBRID V3 BRAIN (Grok Edition)
// Merges "Smart Money" Sweeps with "Multi-Factor" Validation

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

// ---------------- HELPERS ---------------- //

function calculateSMA(data: number[], period: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(NaN);
            continue;
        }
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j];
        }
        sma.push(sum / period);
    }
    return sma;
}

function calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const ema: number[] = [data[0]]; // Seed with first price (or SMA ideally)
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

function calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    // Initial SMA
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smoothed
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }

    const rs = avgGain / (avgLoss || 1); // Avoid div by zero
    return 100 - (100 / (1 + rs));
}

function calculateMACD(closes: number[]): { macd: number, signal: number, hist: number } {
    if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };

    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);

    // MACD Line = EMA12 - EMA26
    const macdLine: number[] = [];
    for (let i = 0; i < closes.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }

    // Signal Line = EMA9 of MACD Line
    // We need to slice the valid part of MACD line? EMA handles it roughly.
    const signalLine = calculateEMA(macdLine, 9);

    const currentMACD = macdLine[macdLine.length - 1];
    const currentSignal = signalLine[signalLine.length - 1];

    return {
        macd: currentMACD,
        signal: currentSignal,
        hist: currentMACD - currentSignal
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
    if (score >= 5.5) action = 'BUY';
    if (score <= -4) action = 'SELL';

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
