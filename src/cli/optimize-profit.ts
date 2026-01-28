
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

async function runOptimization() {
    console.log("🚀 Optimizing Strategy for MAX PROFIT...");

    // Fetch 1 Year Data
    const history = await fetchHistoricalCandles("BTCUSDT", "1d", 365);

    // Configurations to Test
    const configs = [
        { name: "5x Scalp (Safe)", holdDays: 1, tp: 0.03 },
        { name: "10x Pro (Smart)", holdDays: 1, tp: 0.04 } // Tries for 4% move, leverage handled by engine
    ];

    for (const cfg of configs) {
        let capital = 10000;
        let wins = 0;
        let losses = 0;

        for (let i = 0; i < history.length - cfg.holdDays; i++) {
            const entryDay = history[i];
            const metric = createMetric(entryDay);

            // Generate Signal using our Engine
            const signal = generateTradeSignal([metric], undefined, '24h', 'SAFE');

            if (signal.action !== 'NEUTRAL') {
                const entryPrice = entryDay.close;
                const tpPrice = signal.action === 'BUY' ? entryPrice * (1 + cfg.tp) : entryPrice * (1 - cfg.tp);

                // Structural SL (Engine Logic)
                const slPrice = signal.stopLoss || (signal.action === 'BUY' ? entryDay.low * 0.99 : entryDay.high * 1.01);

                // Check subsequent days
                let outcome = 0; // 0=Open, 1=Win, -1=Loss

                for (let d = 1; d <= cfg.holdDays; d++) {
                    const currentDay = history[i + d];

                    if (signal.action === 'BUY') {
                        if (currentDay.low <= slPrice) { outcome = -1; break; } // SL Hit
                        if (currentDay.high >= tpPrice) { outcome = 1; break; } // TP Hit
                    } else { // SELL
                        if (currentDay.high >= slPrice) { outcome = -1; break; }
                        if (currentDay.low <= tpPrice) { outcome = 1; break; }
                    }
                }

                // If held till end and profitable?
                if (outcome === 0) {
                    const endPrice = history[i + cfg.holdDays].close;
                    const pnl = signal.action === 'BUY' ? (endPrice - entryPrice) : (entryPrice - endPrice);
                    if (pnl > 0) outcome = 1; else outcome = -1;
                }

                // Update Capital Logic (Leverage Enhanced)
                const lev = signal.leverage === '10x' ? 10 : 5;
                const positionSize = capital * 0.2; // Use 20% of account per trade

                if (outcome === 1) {
                    // WIN: +TP% * Leverage
                    const priceMove = Math.abs((tpPrice - entryPrice) / entryPrice);
                    const gain = positionSize * priceMove * lev;
                    capital += gain;
                    wins++;
                } else {
                    // LOSS: -SL% * Leverage
                    const priceMove = Math.abs((slPrice - entryPrice) / entryPrice);
                    const loss = positionSize * priceMove * lev;
                    capital -= loss;
                    losses++;
                }

                if (capital < 0) capital = 0; // Bust
            }
        }

        console.log(`\n📋 Config: ${cfg.name}`);
        console.log(`   Final Balance: $${capital.toFixed(2)}`);
        console.log(`   Wins: ${wins} | Losses: ${losses} | WR: ${((wins / (wins + losses)) * 100).toFixed(0)}%`);
    }
}

runOptimization();
