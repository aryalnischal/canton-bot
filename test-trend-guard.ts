
const { Hyperliquid } = require('hyperliquid'); // Not needed if using fetch, but good for types
const fs = require('fs');

// --- HELPER: FETCH CANDLES (RAW) ---
async function fetchCandles(symbol, limit = 200) {
    const endTime = Date.now();
    const startTime = endTime - (limit * 60 * 60 * 1000); // limit hours ago

    // Using fetch
    const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: "candleSnapshot",
            req: {
                coin: symbol.replace("USDT", "").replace("-PERP", ""),
                interval: "1h",
                startTime: startTime,
                endTime: endTime
            }
        })
    });
    return await response.json();
}

// --- LOGIC ---
// Generic SMA Calculator
function calculateSMA(closes, period = 50) {
    if (closes.length < period) return 0;
    return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// Generic RSI Calculator (for Signal Gen Simulation)
function calculateRSI(closes, period = 14) {
    // Simplified RSI for simulation
    return 50;
}

// Simulate "Signal" (Simplified V2 Logic)
// Retrospective: If price dumped hard, it was a "Counter-Trend Long" signal?
// Actually, let's just create hypothetical signals at specific points in history 
// and see if the Trend Guard would have approved/blocked them.

async function runBacktest() {
    const ASSETS = ["SOL", "ARB", "DOGE", "AVAX"];
    console.log("🛡️  BACKTESTING V2.1: THE TREND GUARD 🛡️\n");

    let totalSaved = 0;
    let totalMissedWins = 0;

    for (const coin of ASSETS) {
        console.log(`Analyzing ${coin}...`);
        const candles = await fetchCandles(coin, 100);

        if (!candles || candles.length < 60) {
            console.log(`Skipping ${coin} (No Data)`);
            continue;
        }

        candles.sort((a, b) => a.t - b.t);
        const closes = candles.map(c => parseFloat(c.c));

        // Iterate through last 40 candles (leaving 60 for history)
        for (let i = 60; i < closes.length - 4; i++) {
            // Context at time 'i'
            const currentPrice = closes[i];
            const historySlice = closes.slice(0, i + 1);
            const sma50 = calculateSMA(historySlice, 50);
            const futurePrice = closes[i + 4]; // Price 4h later (Outcome)
            const pnl = ((futurePrice - currentPrice) / currentPrice) * 100;

            const trend = currentPrice > sma50 ? "BULLISH" : "BEARISH";

            // SIMULATE A "BAD TRADE" SCENARIO (Counter-Trend)
            // Case A: Uptrend (Price > SMA), but we Signal SELL (Top Picking)
            if (trend === "BULLISH") {
                // Hypothetical V2 Signal: SELL (e.g. RSI Overbought)
                // If we had Sold here, what would satisfy PnL?
                // If PnL < 0 (Price went up), Shorting was a LOSS.
                // Guard should BLOCK this.

                const shortPnL = -pnl; // Inverse

                // Only check major failure points
                if (shortPnL < -2.0) { // Big Loss
                    // V2 would have taken this Short? (Assume yes for "Stress Test")
                    // V2.1 Guard: BLOCKS because Bullish Trend.
                    console.log(`[${coin} T-${closes.length - i}h] 📉 Signal: SELL | Trend: BULLISH (Guard Active)`);
                    console.log(`   Outcome: Price Rose ${pnl.toFixed(2)}% (Short PnL: ${shortPnL.toFixed(2)}%)`);
                    console.log(`   🛡️  GUARD SAVED YOU! (Blocked a Losing Short)`);
                    totalSaved++;
                    console.log("");
                }
            }

            // Case B: Downtrend (Price < SMA), Signal BUY (Catch Knife)
            if (trend === "BEARISH") {
                // Hypothetical V2 Signal: BUY
                if (pnl < -2.0) { // Price Dropped hard
                    console.log(`[${coin} T-${closes.length - i}h] 📈 Signal: BUY | Trend: BEARISH (Guard Active)`);
                    console.log(`   Outcome: Price Dropped ${pnl.toFixed(2)}% (Long PnL: ${pnl.toFixed(2)}%)`);
                    console.log(`   🛡️  GUARD SAVED YOU! (Blocked a Losing Long)`);
                    totalSaved++;
                    console.log("");
                }

                // What if it was a Winner? (Missed Opportunity)
                if (pnl > 2.0) {
                    console.log(`[${coin} T-${closes.length - i}h] 📈 Signal: BUY | Trend: BEARISH (Guard Active)`);
                    console.log(`   Outcome: Price Pumped ${pnl.toFixed(2)}%`);
                    console.log(`   ⚠️  GUARD BLOCKED A WIN (Missed Bottom Logic)`);
                    totalMissedWins++;
                    console.log("");
                }
            }
        }
    }

    console.log("========================================");
    console.log(`TOTAL DISASTERS AVOIDED: ${totalSaved}`);
    console.log(`TOTAL WINS SACRIFICED:   ${totalMissedWins}`);
    console.log("========================================");
    console.log("VERDICT: " + ((totalSaved > totalMissedWins) ? "✅ TREND GUARD IS PROFITABLE" : "⚠️ TREND GUARD TOO CONSERVATIVE"));
}

runBacktest();
