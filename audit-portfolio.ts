
const { Hyperliquid } = require('hyperliquid');
const { Wallet } = require('ethers');
const fs = require('fs');
const dotenv = require('dotenv');

// Load Env
try {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

// Helper: Calculate RSI
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smoothed
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

async function auditPortfolio() {
    console.log("📊 AUDITING ACTIVE PORTFOLIO...");

    const pKey = process.env.HL_PRIVATE_KEY;
    const walletAddr = process.env.HL_WALLET_ADDRESS;
    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false);

    try {
        const userState = await sdk.info.perpetuals.getClearinghouseState(walletAddr);
        const active = userState.assetPositions.filter(p => parseFloat(p.position.szi) !== 0);

        if (active.length === 0) {
            console.log("No active positions to audit.");
            return;
        }

        const universe = (await sdk.info.perpetuals.getMeta()).universe;
        const results = [];

        console.log(`Analyzing ${active.length} assets...`);

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const p of active) {
            await sleep(200); // 5 Requests/Sec Limit Protection
            const coin = p.position.coin; // e.g., "AVAX-PERP" (Need to handle SDK name)
            const symbol = coin.replace("-PERP", ""); // Raw Symbol
            const size = parseFloat(p.position.szi);
            const entry = parseFloat(p.position.entryPx);
            const isLong = size > 0;
            const lev = p.position.leverage.value;

            // Fetch Market Data (Candles)
            // SDK might require specific symbol format. 
            // We use standard fetch for candles to be safe or SDK if easier.
            // Using SDK for now.

            try {
                // Fetch 1h candles via Raw HTTP (Bypassing SDK wrapper)
                const endTime = Date.now();
                const startTime = endTime - (50 * 60 * 60 * 1000); // 50 hours ago

                const response = await fetch('https://api.hyperliquid.xyz/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: "candleSnapshot",
                        req: {
                            coin: symbol,
                            interval: "1h",
                            startTime: startTime,
                            endTime: endTime
                        }
                    })
                });

                const candles = await response.json();

                if (!Array.isArray(candles) || candles.length < 20) {
                    results.push({ symbol, side: isLong ? "LONG" : "SHORT", verdict: "Unknown", notes: `Data Error: ${JSON.stringify(candles).substring(0, 50)}` });
                    continue;
                }

                // Process Candles (HL returns [ { t, o, h, l, c, v, n }, ... ])
                // Sort by time just in case (usually comes sorted)
                candles.sort((a, b) => a.t - b.t);

                const closes = candles.map(c => parseFloat(c.c));
                const volumes = candles.map(c => parseFloat(c.v));

                const currentPrice = closes[closes.length - 1];

                // Indicators
                const rsi = calculateRSI(closes, 14);

                // Trend (Simple EMA/SMA check) - Price vs SMA 50
                const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / closes.length;
                const trend = currentPrice > sma50 ? "BULLISH" : "BEARISH";

                // Volume Analysis (Last 3 vs avg)
                const avgVol = volumes.slice(0, -3).reduce((a, b) => a + b, 0) / (volumes.length - 3);
                const recentVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
                const volSurge = recentVol > avgVol * 1.5;

                // VERDICT LOGIC
                let quality = "NEUTRAL";
                let reason = "";

                if (isLong) {
                    if (trend === "BULLISH") {
                        if (rsi < 70) {
                            quality = "✅ GOOD";
                            reason = "Uptrend & RSI OK";
                            if (volSurge) reason += " + Vol Surge";
                        } else {
                            quality = "⚠️ RISKY";
                            reason = "Overbought (RSI > 70)";
                        }
                    } else {
                        // Counter-trend Long
                        if (rsi < 30) { quality = "✅ GOOD"; reason = "Oversold Reversal"; }
                        else { quality = "❌ BAD"; reason = "Fighting Downtrend (RSI neutral)"; }
                    }
                } else { // Short
                    if (trend === "BEARISH") {
                        if (rsi > 30) {
                            quality = "✅ GOOD";
                            reason = "Downtrend & RSI OK";
                            if (volSurge) reason += " + Vol Surge";
                        } else {
                            quality = "⚠️ RISKY";
                            reason = "Oversold (RSI < 30)";
                        }
                    } else {
                        // Counter-trend Short
                        if (rsi > 70) { quality = "✅ GOOD"; reason = "Overbought Reversal"; }
                        else { quality = "❌ BAD"; reason = "Fighting Uptrend (RSI neutral)"; }
                    }
                }

                results.push({
                    symbol,
                    side: isLong ? "LONG" : "SHORT",
                    lev: `${lev}x`,
                    entry: entry.toFixed(4),
                    mark: currentPrice.toFixed(4),
                    rsi: rsi.toFixed(1),
                    trend,
                    verdict: quality,
                    notes: reason
                });

            } catch (e) {
                console.error(`Error analyzing ${symbol}:`, e.message);
                results.push({ symbol, error: e.message });
            }
        }

        console.table(results);
        // Write to file for Agent to read
        fs.writeFileSync('audit-result.json', JSON.stringify(results, null, 2));

    } catch (e) {
        console.error("Audit Runtime Error:", e);
    }
}

auditPortfolio();
