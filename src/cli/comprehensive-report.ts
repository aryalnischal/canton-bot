
import { fetchHistoricalCandles } from "../lib/backtest-api";
import { generateTradeSignal } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

// Factory
const createMetric = (candle: any): ExchangeMetric => ({
    rank: 1,
    exchange: "Binance",
    pair: "BTC/USDT",
    price: candle.close,
    priceChange24h: ((candle.close - candle.open) / candle.open) * 100,
    volume24h: candle.volume,
    volumeChange24h: 0,
    openInterest: 0,
    openInterestChange24h: 0,
    longShortRatio: 1,
    longLiq24h: 0,
    shortLiq24h: 0,
    fundingRate: 0.0001,
    high24h: candle.high,
    low24h: candle.low,
    marketType: 'FUTURES'
});

async function runReport() {
    console.log("📊 GENERATING COMPREHENSIVE BTC REPORT (Smart 10x)...");

    // 1. Fetch Data
    const history = await fetchHistoricalCandles("BTCUSDT", "1d", 366); // +1 buffer
    if (history.length < 365) {
        console.error("Insufficient history fetched.");
        return;
    }

    const periods = [
        { label: "Last Year (365d)", days: 365 },
        { label: "Last 6 Months (180d)", days: 180 },
        { label: "Last Month (30d)", days: 30 },
        { label: "Last Week (7d)", days: 7 }
    ];

    const cfg = { tp: 0.04 }; // 4% Move Target

    for (const p of periods) {
        // Slice the history to the last N days
        // history is oldest -> newest.
        // slice(-N) gives last N items.
        // We need N+1 items to have "Next Day" for the last item? 
        // Simulation loop iterates `length - 1`.

        const subset = history.slice(-p.days - 1); // Get N+1 candles

        let capital = 10000;
        let wins = 0;
        let losses = 0;
        let trades = 0;

        for (let i = 0; i < subset.length - 1; i++) {
            const entryDay = subset[i];
            const nextDay = subset[i + 1];

            const metric = createMetric(entryDay);
            // Run Signal
            const signal = generateTradeSignal([metric], undefined, '24h', 'SAFE');

            if (signal.action !== 'NEUTRAL') {
                trades++;
                const entryPrice = entryDay.close;
                const tpPrice = signal.action === 'BUY' ? entryPrice * (1 + cfg.tp) : entryPrice * (1 - cfg.tp);

                // Smart SL
                const slPrice = signal.stopLoss || (signal.action === 'BUY' ? entryDay.low * 0.99 : entryDay.high * 1.01);

                // Check Next Day Outcome
                let outcome = 0;
                if (signal.action === 'BUY') {
                    if (nextDay.low <= slPrice) outcome = -1;
                    else if (nextDay.high >= tpPrice) outcome = 1;
                } else {
                    if (nextDay.high >= slPrice) outcome = -1;
                    else if (nextDay.low <= tpPrice) outcome = 1;
                }

                // If undefined, close at close
                if (outcome === 0) {
                    const pnl = signal.action === 'BUY' ? (nextDay.close - entryPrice) : (entryPrice - nextDay.close);
                    outcome = pnl > 0 ? 1 : -1;
                }

                const lev = signal.leverage === '10x' ? 10 : 5;
                const positionSize = capital * 0.2;

                if (outcome === 1) {
                    const move = Math.abs((tpPrice - entryPrice) / entryPrice);
                    capital += positionSize * move * lev;
                    wins++;
                } else {
                    const move = Math.abs((slPrice - entryPrice) / entryPrice);
                    capital -= positionSize * move * lev;
                    losses++;
                }

                if (capital < 0) capital = 0;
            }
        }

        const roi = ((capital - 10000) / 10000) * 100;
        console.log(`\n📅 ${p.label}:`);
        console.log(`   ROI: ${roi > 0 ? '+' : ''}${roi.toFixed(2)}%  ($${capital.toFixed(0)})`);
        console.log(`   Trades: ${trades} | Win Rate: ${trades > 0 ? ((wins / trades) * 100).toFixed(0) : 0}%`);
    }

    // 2. TODAY'S STATUS
    console.log("\n📡 TODAY'S LIVE STATUS:");
    try {
        // Mocking a live fetch or reusing last candle?
        // Let's use the very last candle from history as "Today" (if api returns pending candle)
        // Or fetch fresh.
        const lastCandle = history[history.length - 1];
        const prevCandle = history[history.length - 2];

        // Check if last candle is "Fresh" (Close time > now?)
        // Binance API klines returns the open candle as last.
        // So `lastCandle` IS Today.

        const liveMetric = createMetric(lastCandle);
        // We need accurate change? `priceChange` in metric is calculated from candle open/close.
        // Correct.

        const liveSignal = generateTradeSignal([liveMetric], undefined, '24h', 'SAFE');

        console.log(`   Price: $${lastCandle.close.toLocaleString()}`);
        console.log(`   24h Range: $${lastCandle.low.toLocaleString()} - $${lastCandle.high.toLocaleString()}`);
        console.log(`   Signal: ${liveSignal.action} ${liveSignal.leverage}`);
        if (liveSignal.action !== 'NEUTRAL') {
            console.log(`   Confidence: ${liveSignal.confidence}%`);
            console.log(`   Reasons: ${liveSignal.reasons.join(", ")}`);
        } else {
            console.log(`   Reason: No clear setup yet (Waiting for Volatility/Liquidity)`);
        }

    } catch (e) {
        console.log("   Unable to fetch live data.");
    }
}

runReport();
