
import { fetchHistoricalCandles } from "../lib/backtest-api";
import { generateTradeSignal } from "../lib/analysis";
import { ExchangeMetric } from "../lib/types";

const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];

// Factory
const createMetric = (candle: any, symbol: string): ExchangeMetric => ({
    rank: 1,
    exchange: "Binance",
    pair: symbol.replace("USDT", "/USDT"),
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

async function runMultiValidation() {
    console.log("🌍 Running Multi-Asset Validation (Smart 10x Strategy)...");

    // Config: Smart 10x
    const cfg = { holdDays: 1, tp: 0.04 };

    for (const symbol of ASSETS) {
        console.log(`\n🔄 Fetching Data for ${symbol}...`);
        const history = await fetchHistoricalCandles(symbol, "1d", 365);

        if (history.length < 100) {
            console.log(`⚠️  Skipping ${symbol} (Insufficient Data)`);
            continue;
        }

        let capital = 10000;
        let wins = 0;
        let losses = 0;
        let trades = 0;

        for (let i = 0; i < history.length - cfg.holdDays; i++) {
            const entryDay = history[i];
            const metric = createMetric(entryDay, symbol);

            // Generate Signal
            const signal = generateTradeSignal([metric], undefined, '24h', 'SAFE');

            if (signal.action !== 'NEUTRAL') {
                trades++;
                const entryPrice = entryDay.close;
                const tpPrice = signal.action === 'BUY' ? entryPrice * (1 + cfg.tp) : entryPrice * (1 - cfg.tp);

                // Smart SL from Engine
                const slPrice = signal.stopLoss || (signal.action === 'BUY' ? entryDay.low * 0.99 : entryDay.high * 1.01);

                // Simulation (Next Day)
                let outcome = 0; // 0=Open, 1=Win, -1=Loss
                for (let d = 1; d <= cfg.holdDays; d++) {
                    const currentDay = history[i + d];
                    if (signal.action === 'BUY') {
                        if (currentDay.low <= slPrice) { outcome = -1; break; }
                        if (currentDay.high >= tpPrice) { outcome = 1; break; }
                    } else {
                        if (currentDay.high >= slPrice) { outcome = -1; break; }
                        if (currentDay.low <= tpPrice) { outcome = 1; break; }
                    }
                }

                if (outcome === 0) {
                    // Close at end of hold
                    const endPrice = history[i + cfg.holdDays].close;
                    const pnl = signal.action === 'BUY' ? (endPrice - entryPrice) : (entryPrice - endPrice);
                    outcome = pnl > 0 ? 1 : -1;
                }

                // Update Capital
                const lev = signal.leverage === '10x' ? 10 : 5;
                const positionSize = capital * 0.2; // 20% sizing

                if (outcome === 1) {
                    const move = Math.abs((tpPrice - entryPrice) / entryPrice);
                    capital += positionSize * move * lev;
                    wins++;
                } else {
                    const move = Math.abs((slPrice - entryPrice) / entryPrice);
                    capital -= positionSize * move * lev; // LOSS
                    losses++;
                }

                if (capital < 500) capital = 500; // Floor
            }
        }

        const roi = ((capital - 10000) / 10000) * 100;
        console.log(`📊 ${symbol} Results:`);
        console.log(`   Capital: $${capital.toFixed(2)} (${roi.toFixed(1)}%)`);
        console.log(`   Trades: ${trades} | WR: ${((wins / trades) * 100).toFixed(0)}%`);

        if (roi > 0) console.log(`   ✅ VALIDATED (${symbol} is profitable)`);
        else console.log(`   ⚠️  CAUTION (${symbol} needs custom tuning)`);
    }
}

runMultiValidation();
