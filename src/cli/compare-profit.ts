
import { fetchHistoricalCandles } from "../lib/backtest-api";
import { generateTradeSignal, TradeSignal } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

// Mock Factory
const createMetric = (candle: any, prevCandle: any): ExchangeMetric => ({
    rank: 1,
    exchange: "Binance",
    pair: "BTC/USDT",
    price: candle.close,
    priceChange24h: ((candle.close - candle.open) / candle.open) * 100, // Approx
    volume24h: candle.volume,
    volumeChange24h: 0,
    openInterest: 0,
    openInterestChange24h: 0,
    longShortRatio: 1,
    longLiq24h: 0,
    shortLiq24h: 0,
    fundingRate: 0.0001,
    // CRITICAL: New Logic relies on 24h High/Low. 
    // In a daily candle, High/Low IS the 24h High/Low.
    high24h: candle.high,
    low24h: candle.low,
    marketType: 'FUTURES'
});

async function runComparison() {
    console.log("⚖️  Comparing Stop Loss Strategies (Fixed vs Structural)...");

    const history = await fetchHistoricalCandles("BTCUSDT", "1d", 365);
    if (history.length < 10) return console.error("Not enough data.");

    let pnlFixed = 10000;
    let pnlDynamic = 10000;

    let tradesFixed = 0;
    let tradesDynamic = 0;

    let winsFixed = 0;
    let winsDynamic = 0;

    // Simulation Loop
    for (let i = 1; i < history.length - 1; i++) {
        const day = history[i];
        const nextDay = history[i + 1];

        const metric = createMetric(day, history[i - 1]);
        const s = generateTradeSignal([metric], undefined, '24h', 'SAFE');

        if (s.action !== 'NEUTRAL') {
            const entry = day.close; // Assume we enter at Close (End of Day Analysis)

            // --- STRATEGY A: Fixed 2% SL ---
            const slFixed = s.action === 'BUY' ? entry * 0.98 : entry * 1.02;
            const tpFixed = s.action === 'BUY' ? entry * 1.05 : entry * 0.95; // 5% Target

            // Check Next Day Outcome
            // Did we hit SL first or TP first? 
            // Simplified: Check Low/High of next day.
            let resultFixed = 0; // 0 = Hold, 1 = Win, -1 = Loss

            if (s.action === 'BUY') {
                if (nextDay.low <= slFixed) resultFixed = -1; // Stopped Out
                else if (nextDay.high >= tpFixed) resultFixed = 1; // Take Profit
                else resultFixed = 0.1; // Held (Small unrealized gain/loss, ignored for simple test)
            } else {
                if (nextDay.high >= slFixed) resultFixed = -1;
                else if (nextDay.low <= tpFixed) resultFixed = 1;
            }

            if (resultFixed === 1) { pnlFixed *= 1.05; winsFixed++; tradesFixed++; }
            if (resultFixed === -1) { pnlFixed *= 0.98; tradesFixed++; }

            // --- STRATEGY B: Dynamic Structural SL (New) ---
            const slDynamic = s.stopLoss || (s.action === 'BUY' ? entry * 0.98 : entry * 1.02);
            const tpDynamic = s.target || (s.action === 'BUY' ? entry * 1.05 : entry * 0.95);

            let resultDynamic = 0;
            if (s.action === 'BUY') {
                if (nextDay.low <= slDynamic) resultDynamic = -1;
                else if (nextDay.high >= tpDynamic) resultDynamic = 1;
            } else {
                if (nextDay.high >= slDynamic) resultDynamic = -1;
                else if (nextDay.low <= tpDynamic) resultDynamic = 1;
            }

            if (resultDynamic === 1) { pnlDynamic *= 1.05; winsDynamic++; tradesDynamic++; }
            if (resultDynamic === -1) {
                // Loss Calc: Percentage distance to SL
                const risk = Math.abs((entry - slDynamic) / entry);
                pnlDynamic *= (1 - risk);
                tradesDynamic++;
            }
        }
    }

    console.log("\n📈 Results (Initial Capital: $10,000):");
    console.log("-----------------------------------------");
    console.log(`strategy    | Final Balance | Trades | Win Rate`);
    console.log(`------------|---------------|--------|---------`);
    console.log(`OLD (Fixed) | $${pnlFixed.toFixed(2)}     | ${tradesFixed}     | ${((winsFixed / tradesFixed) * 100).toFixed(1)}%`);
    console.log(`NEW (Smart) | $${pnlDynamic.toFixed(2)}   | ${tradesDynamic}     | ${((winsDynamic / tradesDynamic) * 100).toFixed(1)}%`);
    console.log("-----------------------------------------");

    if (pnlDynamic > pnlFixed) console.log("✅ CONCLUSION: Structural Stops Increased Profitability.");
    else console.log("⚠️ CONCLUSION: Fixed Stops were safer (Market was volatile).");
}

runComparison();
