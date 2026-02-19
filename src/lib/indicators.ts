// Shared Technical Indicator Library
// Eliminates duplicate RSI/EMA/SMA/MACD implementations across V3, V4, V2.

export function calculateSMA(data: number[], period: number): number[] {
    const sma: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { sma.push(NaN); continue; }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j];
        sma.push(sum / period);
    }
    return sma;
}

export function calculateEMA(data: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const ema: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

export function calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
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

export function calculateMACD(closes: number[]): { macd: number, signal: number, hist: number } {
    if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macdLine: number[] = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const currentMACD = macdLine[macdLine.length - 1];
    const currentSignal = signalLine[signalLine.length - 1];
    return { macd: currentMACD, signal: currentSignal, hist: currentMACD - currentSignal };
}

export function calculateATR(candles: { c: number, h?: number, l?: number }[], period: number): number {
    if (candles[0]?.h && candles[0]?.l) {
        const trs: number[] = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].h!;
            const low = candles[i].l!;
            const prevClose = candles[i - 1].c;
            trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }
    const closes = candles.map(c => c.c).slice(-period);
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    return Math.sqrt(variance);
}
