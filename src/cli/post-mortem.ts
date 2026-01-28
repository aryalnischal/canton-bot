
import { fetchHistoricalCandles } from "../lib/backtest-api";
import { generateTradeSignal } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

// Factory (Simplified)
const createMetric = (candle: any, symbol: string): ExchangeMetric => ({
    rank: 1,
    exchange: "Binance",
    pair: symbol.replace("USDT", "/USDT"),
    price: candle.close,
    priceChange24h: ((candle.close - candle.open) / candle.open) * 100, // Placeholder, updated in loop
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

async function runPostMortem() {
    console.log("🕵️ AUTOMATED POST-MORTEM: Analyzing Last 48 Hours...");

    // We need more data to calculate rolling 24h stats properly
    // Fetch 72h, analyze last 48h
    const assets = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

    for (const symbol of assets) {
        console.log(`\n🔍 Analyzing ${symbol}...`);
        const candles = await fetchHistoricalCandles(symbol, "1h", 72);

        if (candles.length < 50) {
            console.log("   Not enough data.");
            continue;
        }

        let balance = 10000;
        let trades = [];

        // Loop through last 48 hours
        for (let i = 24; i < candles.length - 1; i++) {
            const currentCandle = candles[i];

            // Calculate Rolling 24h Stats (CORRECTED)
            const past24 = candles.slice(i - 24, i);
            const high24h = Math.max(...past24.map(c => c.high));
            const low24h = Math.min(...past24.map(c => c.low));
            const open24h = candles[i - 24].open;
            const change24h = ((currentCandle.close - open24h) / open24h) * 100;

            const metric = createMetric(currentCandle, symbol);
            metric.high24h = high24h;
            metric.low24h = low24h;
            metric.priceChange24h = change24h; // Injects true 24h trend

            // Generate Signal
            const signal = generateTradeSignal([metric], undefined, 'AUTO', 'SAFE');

            if (signal.action !== 'NEUTRAL') {
                // Duplicate Handling
                if (trades.length > 0 && (i - trades[trades.length - 1].index) < 4) continue;

                const entryPrice = currentCandle.close;

                // TP/SL from Engine
                let tp = signal.target || (signal.action === 'BUY' ? entryPrice * 1.04 : entryPrice * 0.96);
                let sl = signal.stopLoss || (signal.action === 'BUY' ? low24h * 0.99 : high24h * 1.01);

                const lev = signal.leverage === '10x' ? 10 : 5;

                let outcome = "OPEN";
                let exitPrice = 0;
                let failReason = "";

                // Look ahead up to 12 hours
                for (let j = 1; j <= 12 && (i + j) < candles.length; j++) {
                    const future = candles[i + j];

                    if (signal.action === 'BUY') {
                        if (future.low <= sl) {
                            outcome = "LOSS";
                            exitPrice = sl;
                            failReason = "Stopped Out (Wick)";
                            const maxFuture = Math.max(...candles.slice(i + j).map(c => c.high));
                            if (maxFuture >= tp) failReason += " -> Then hit TP 💀 (Wicked Out)";
                            break;
                        }
                        if (future.high >= tp) {
                            outcome = "WIN";
                            exitPrice = tp;
                            break;
                        }
                    } else { // SELL
                        if (future.high >= sl) {
                            outcome = "LOSS";
                            exitPrice = sl;
                            failReason = "Stopped Out (Short Squeeze)";
                            const minFuture = Math.min(...candles.slice(i + j).map(c => c.low));
                            if (minFuture <= tp) failReason += " -> Then hit TP 💀 (Fakeout)";
                            break;
                        }
                        if (future.low <= tp) {
                            outcome = "WIN";
                            exitPrice = tp;
                            break;
                        }
                    }
                }

                if (outcome === "LOSS") {
                    const lossPct = Math.abs((exitPrice - entryPrice) / entryPrice) * lev * 100;
                    balance -= balance * (lossPct / 1000);
                    console.log(`   ❌ ${signal.action} ${signal.leverage} @ $${entryPrice.toFixed(2)} | SL: $${sl.toFixed(2)} | Result: -${lossPct.toFixed(2)}% | Reason: ${failReason}`);
                    console.log(`      Time: ${new Date(currentCandle.openTime).toLocaleString()}`);
                } else if (outcome === "WIN") {
                    const winPct = Math.abs((exitPrice - entryPrice) / entryPrice) * lev * 100;
                    balance += balance * (winPct / 1000);
                    console.log(`   ✅ ${signal.action} ${signal.leverage} @ $${entryPrice.toFixed(2)} | TP: $${tp.toFixed(2)} | Result: +${winPct.toFixed(2)}%`);
                } else {
                    console.log(`   ⏳ ${signal.action} ${signal.leverage} @ $${entryPrice.toFixed(2)} | Stalled (No TP/SL hit in 12h)`);
                }

                trades.push({ index: i });
            }
        }
    }
}

runPostMortem();
