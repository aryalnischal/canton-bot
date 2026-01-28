
import { fetchHistoricalCandles } from "../lib/backtest-api";
import { generateTradeSignal, TradeSignal } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

// Mock ExchangeMetric factory
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
    high24h: candle.high, // We assume candle high is approx 24h high for this test context or we should track it
    low24h: candle.low,
    marketType: 'FUTURES'
});

async function runValidation() {
    console.log("🔍 Validating Heuristic Model (Max Pain / Liquidity Logic)...");

    // 1. Fetch Data (BTC)
    const history = await fetchHistoricalCandles("BTCUSDT", "1d", 365); // 1 Year
    if (history.length === 0) {
        console.error("Failed to fetch history.");
        return;
    }

    let signals = 0;
    let wins = 0;
    let heuristicSignals = 0;
    let heuristicWins = 0;

    // Sliding Window to determine 24h High/Low correctly
    // We need at least 1 day of previous data to define "24h Range"
    // Since we fetched 1d candles, each candle represents 24h.
    // So candle.high IS the high24h.

    for (let i = 1; i < history.length - 3; i++) { // Start at 1 to calc changes
        const today = history[i];
        const yesterday = history[i - 1];
        const tomorrow = history[i + 1];

        const volChange = ((today.volume - yesterday.volume) / yesterday.volume) * 100;

        const metric: ExchangeMetric = {
            rank: 1,
            exchange: "Binance",
            pair: "BTC/USDT",
            price: today.close,
            priceChange24h: ((today.close - today.open) / today.open) * 100,
            volume24h: today.volume,
            volumeChange24h: volChange,
            openInterest: 0,
            openInterestChange24h: 0,
            longShortRatio: 1,
            longLiq24h: 0,
            shortLiq24h: 0,
            fundingRate: 0.0001,
            high24h: today.high,
            low24h: today.low,
            marketType: 'FUTURES'
        };

        // Generate Signal with Date Override
        // We use 'today.openTime' so the Night/Day logic matches the candle's time.
        const signal = generateTradeSignal([metric], undefined, '24h', 'SAFE', new Date(today.openTime));

        // Check if Heuristic (Max Pain) was used
        const isHeuristic = signal.reasons.some(r => r.includes("Max Pain") || r.includes("Liquidity"));

        if (signal.action !== 'NEUTRAL') {
            signals++;

            // Validate Result (Did Price move in favor next day?)
            // Buy -> Tomorrow High > Today Close ? Or Close > Close?
            // Conservative: Close > Close
            let isWin = false;
            if (signal.action === 'BUY') isWin = tomorrow.close > today.close;
            if (signal.action === 'SELL') isWin = tomorrow.close < today.close;

            if (isWin) wins++;

            if (isHeuristic) {
                heuristicSignals++;
                if (isWin) heuristicWins++;
            }
        }
    }

    console.log("\n📊 Validation Results (BTC - 365 Days):");
    console.log("-----------------------------------------");
    console.log(`Total Signals: ${signals}`);
    console.log(`Overall Win Rate: ${((wins / signals) * 100).toFixed(2)}%`);
    console.log("-----------------------------------------");
    console.log(`🧠 Heuristic Signals (Max Pain): ${heuristicSignals}`);
    console.log(`🧠 Heuristic Win Rate: ${((heuristicWins / heuristicSignals) * 100).toFixed(2)}%`);
    console.log("-----------------------------------------");

    if ((heuristicWins / heuristicSignals) > 0.6) {
        console.log("✅ CONCLUSION: Heuristic Model is VALID (>60% Accuracy).");
    } else {
        console.log("⚠️ CONCLUSION: Heuristic Model needs refinement.");
    }
}

runValidation();
