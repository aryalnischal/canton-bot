
import axios from 'axios';
import { generateTradeSignal, TradeSignal, ManualAnalysisData } from '../lib/analysis';
import { ExchangeMetric } from '../lib/types';

// Configuration
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1h'; // Using 1h candles for speed/noise balance (Scalping logic uses 15m, we can fetch 15m if needed)
// Use 15m for accurate "Session" simulation
const TIMEFRAME = '15m';

interface Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
}

// 1. Fetch Historical Data (Binance Public API)
async function fetchCandles(startTime: number, endTime: number): Promise<Candle[]> {
    const limit = 1000;
    let allCandles: Candle[] = [];
    let currentStart = startTime;

    console.log(`Fetching Data for ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}...`);

    while (currentStart < endTime) {
        try {
            const url = `https://api.binance.us/api/v3/klines?symbol=${SYMBOL}&interval=${TIMEFRAME}&startTime=${currentStart}&endTime=${endTime}&limit=${limit}`;
            const res = await axios.get(url);
            const data = res.data;

            if (data.length === 0) break;

            const candles = data.map((c: any) => ({
                openTime: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                closeTime: c[6],
            }));

            allCandles = [...allCandles, ...candles];
            currentStart = candles[candles.length - 1].closeTime + 1;

            // Rate Limit Pause
            await new Promise(r => setTimeout(r, 100));
            process.stdout.write('.');
        } catch (e) {
            console.error("Error fetching data:", e);
            break;
        }
    }
    console.log(`\nFetched ${allCandles.length} candles.`);
    return allCandles;
}

// 2. Reconstruct Metrics state from History
// We need to calculate rolling 24h stats for the analysis logic to work (High24h, Low24h, etc.)
function calculateMetrics(candles: Candle[], currentIndex: number): ExchangeMetric {
    const current = candles[currentIndex];

    // Lookback 24h (96 candles of 15m)
    const lookback = 96;
    const startIdx = Math.max(0, currentIndex - lookback);
    const window = candles.slice(startIdx, currentIndex + 1);

    const high24h = Math.max(...window.map(c => c.high));
    const low24h = Math.min(...window.map(c => c.low));
    const volume24h = window.reduce((sum, c) => sum + c.volume, 0);

    // Previous 24h for change calc
    const prev24h = candles[Math.max(0, currentIndex - lookback)];
    const priceChange24h = ((current.close - prev24h.close) / prev24h.close) * 100;

    // Volume Change (Approximate by comparing current vol to avg)
    const avgVol = volume24h / window.length;
    const volumeChange24h = ((current.volume - avgVol) / avgVol) * 100;

    return {
        exchange: 'BINANCE',
        pair: SYMBOL,
        price: current.close,
        priceChange24h,
        volume24h,
        volumeChange24h,
        high24h,
        low24h,
        fundingRate: 0.01, // Mock funding (unavailable in klines)
        openInterest: 0,
        openInterestChange24h: 0,
        longShortRatio: 1,
        longLiq24h: 0,
        shortLiq24h: 0,
        marketType: 'FUTURES',
        rank: 1,
        activeInterval: TIMEFRAME
    };
}

// 3. Backtest Engine
async function runBacktest() {
    const now = Date.now();
    const oneMonth = 30 * 24 * 3600 * 1000;
    const startTime = now - oneMonth;

    const candles = await fetchCandles(startTime, now);

    // STRATEGY A: STATIC (Baseline)
    let balA = 1000;
    let posA: { type: 'LONG' | 'SHORT', price: number } | null = null;
    let statsA = { trades: 0, wins: 0, losses: 0 };

    // STRATEGY B: SESSION (Optimized)
    let balB = 1000;
    let posB: { type: 'LONG' | 'SHORT', price: number } | null = null;
    let statsB = { trades: 0, wins: 0, losses: 0 };

    const startOffset = 96;
    console.log(`--- RUNNING COMPARISON (${candles.length - startOffset} candles) ---`);

    for (let i = startOffset; i < candles.length; i++) {
        const candle = candles[i];
        const metric = calculateMetrics(candles, i);
        // --- SESSION DEFINITION ---
        const date = new Date(candle.openTime);
        const signal = generateTradeSignal([metric], undefined, TIMEFRAME, 'SAFE', date);
        const utcHour = date.getUTCHours();
        // CST is UTC-6. Day: 8AM CST (14 UTC) to 8PM CST (02 UTC)
        // 14, 15... 23, 0, 1 -> Day. 2... 13 -> Night.
        const isDay = (utcHour >= 14 || utcHour < 2);

        // --- STRATEGY A EXECUTION (Static) ---
        if (posA) {
            // Check Exit using DYNAMIC TARGET from Signal if available
            // If we stored the target in posA, we could use it. For now, let's look at Price.
            // Simplified: If Price hits the stored 'Target' price?
            // Since we didn't store Target in posA, let's use the 2% fixed for Baseline A 
            // (since A is "Static Strategy").

            const pnl = posA.type === 'LONG' ? (candle.close - posA.price) / posA.price : (posA.price - candle.close) / posA.price;
            if (pnl > 0.02 || pnl < -0.01) {
                balA *= (1 + pnl);
                pnl > 0 ? statsA.wins++ : statsA.losses++;
                statsA.trades++;
                // DEBUG: Log Loss Time
                if (pnl < 0) console.log(`[LOSS] Hour: ${utcHour} (UTC) | IsDay: ${isDay} | Change: ${metric.priceChange24h.toFixed(2)}%`);
                posA = null;
            }
        } else if (signal.action !== 'NEUTRAL' && signal.confidence >= 2) {
            posA = { type: signal.action === 'BUY' ? 'LONG' : 'SHORT', price: candle.close };
            // DEBUG: Log Entry
            console.log(`[ENTRY] Hour: ${utcHour} (UTC) | IsDay: ${isDay} | Action: ${signal.action}`);
        }

        // --- STRATEGY B EXECUTION (Session Smart - PROPOSED) ---
        // Rule: Night Mode = OFF. We DO NOT TRADE.
        // Unless it's a massive anomaly (Confidence > 8).
        // Day Mode = Normal.

        let thresholdB = 100; // Default to BLOCK
        if (isDay) thresholdB = 2; // Normal
        else thresholdB = 8; // Extreme Only (Sniper)

        if (posB) {
            const pnl = posB.type === 'LONG' ? (candle.close - posB.price) / posB.price : (posB.price - candle.close) / posB.price;

            // DYNAMIC EXIT (SMART):
            // If the signal has a specific "Flush Target" (Magnet), we use it.
            // Otherwise, we default to 2% (Safe).
            let targetPct = 0.02;

            // Calculate implied target % from signal.target if it exists
            if (signal.target && signal.target > 0) {
                if (posB.type === 'LONG') targetPct = (signal.target - posB.price) / posB.price;
                else targetPct = (posB.price - signal.target) / posB.price;

                // Safety: Cap ridiculous targets at 10%, floor at 1%
                if (targetPct > 0.10) targetPct = 0.10;
                if (targetPct < 0.01) targetPct = 0.01;
            } else if (signal.leverage === '10x') {
                targetPct = 0.04; // Sniper Mode default
            }

            if (pnl > targetPct || pnl < -0.01) {
                balB *= (1 + pnl);
                pnl > 0 ? statsB.wins++ : statsB.losses++;
                statsB.trades++;
                posB = null;
            }
        } else if (signal.action !== 'NEUTRAL' && signal.confidence >= thresholdB) {
            posB = { type: signal.action === 'BUY' ? 'LONG' : 'SHORT', price: candle.close };
        }
    }

    console.log("\n--- RESULT: STATIC STRATEGY ---");
    console.log(`Balance: $${balA.toFixed(2)} | Trades: ${statsA.trades} | Win Rate: ${((statsA.wins / statsA.trades) * 100).toFixed(1)}%`);

    console.log("\n--- RESULT: SESSION STRATEGY (Day=Trend / Night=Sniper) ---");
    console.log(`Balance: $${balB.toFixed(2)} | Trades: ${statsB.trades} | Win Rate: ${((statsB.wins / statsB.trades) * 100).toFixed(1)}%`);
}

runBacktest();
