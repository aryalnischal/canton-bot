
import { generateV5Consensus } from "../lib/v5/analysis-v5";
import { synthesizeHistoricalData } from "./synthetic-adapters";
import { ExchangeMetric } from "../lib/types";

// BACKTEST CONFIGURATION
const ASSETS = ["BTC", "ETH", "SOL", "SUI", "DOGE"];
const PERIODS = [
    { name: "1 Week", days: 7 },
    { name: "2 Weeks", days: 14 },
    { name: "1 Month", days: 30 },
    { name: "6 Months", days: 180 }
];

async function fetchCandles(coin: string, days: number): Promise<any[]> {
    const limit = Math.floor((days * 24)); // 1h candles
    // Basic Rate Limit Avoidance
    await new Promise(r => setTimeout(r, 200));

    // We use Hyperliquid API directly or mocked if unstable
    // Using simple fetch logic
    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);

    try {
        const res = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: "candleSnapshot",
                req: { coin, interval: "1h", startTime, endTime }
            })
        });
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        return data.map((c: any) => ({
            t: c.t,
            o: parseFloat(c.o),
            h: parseFloat(c.h),
            l: parseFloat(c.l),
            c: parseFloat(c.c),
            v: parseFloat(c.v)
        })).sort((a: any, b: any) => a.t - b.t);
    } catch (e) {
        console.error(`Failed to fetch ${coin}:`, e);
        return [];
    }
}

async function runBacktest(periodName: string, days: number) {
    console.log(`\n=== BACKTESTING PERIOD: ${periodName} ===`);
    let totalTrades = 0;
    let totalWins = 0;
    let totalProfit = 0;

    for (const coin of ASSETS) {
        const candles = await fetchCandles(coin, days);
        if (candles.length < 50) {
            console.log(`Skipping ${coin} (Not enough data)`);
            continue;
        }

        let coinProfit = 0;
        let coinTrades = 0;
        let coinWins = 0;

        // Iterate through time
        for (let i = 50; i < candles.length - 1; i++) {
            const current = candles[i];
            const next = candles[i + 1]; // Lookahead for result

            // 1. Synthesize Intelligence Data
            const synthetic = synthesizeHistoricalData(candles, i);
            if (!synthetic) continue;

            // 2. Format Metrics with Real 24h Changes
            let priceChange = 0;
            let volChange = 0;

            if (i >= 24) {
                const prev24h = candles[i - 24];
                priceChange = ((current.c - prev24h.c) / prev24h.c) * 100;
                // Simple Vol Change (Current vs 24h Avg)
                const volAvg = candles.slice(i - 24, i).reduce((a, b) => a + b.v, 0) / 24;
                volChange = ((current.v - volAvg) / volAvg) * 100;
            }

            const metrics: ExchangeMetric[] = [{
                symbol: coin + "USDT",
                price: current.c,
                priceChange24h: priceChange,
                volumeChange24h: volChange,
                high24h: current.h, // Approx implies we need rolling high. Using current H is weak but acceptable for sim.
                low24h: current.l,
                fundingRate: synthetic.fundingRate,
                open: current.o,
                rank: 0,
                exchange: 'hyperliquid',
                pair: coin + "USDT",
                volume24h: 0,
                last_updated: Date.now()
            } as any];

            // 3. Run V5 Logic
            const consensus = generateV5Consensus(
                metrics,
                candles.slice(i - 49, i + 1), // 50 candle window
                { levels: [[], []] }, // Empty Orderbook (V3 will skip or be weak)
                synthetic.coinglass,
                synthetic.onChain,
                synthetic.maxPain,
                synthetic.fundingRate
            );

            // 4. Execute Trade (Simulation)
            // Rules: Enter on Signal. Exit after 1 candle (1h scalp) or TP/SL?
            // Simple: Hold for 1 bar
            if (consensus.action !== 'NEUTRAL' && Math.abs(consensus.score) > 0.45) {
                const entry = current.c;
                const exit = next.c;
                let returnPct = (exit - entry) / entry;

                if (consensus.action === 'SELL') returnPct = -returnPct;

                // Leverage Multiplier (Simulated)
                const leverage = consensus.leverage || 5;
                const pnl = returnPct * leverage * 100; // % PnL

                coinProfit += pnl;
                coinTrades++;
                if (pnl > 0) coinWins++;
            }
        }

        const winRate = coinTrades > 0 ? (coinWins / coinTrades) * 100 : 0;
        console.log(`   ${coin}: ${coinTrades} Trades | Win Rate: ${winRate.toFixed(1)}% | Net PnL: ${coinProfit.toFixed(2)}%`);

        totalTrades += coinTrades;
        totalWins += coinWins;
        totalProfit += coinProfit;
    }

    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    console.log(`\n>> TOTAL RESULTS (${periodName}):`);
    console.log(`   Trades: ${totalTrades}`);
    console.log(`   Win Rate: ${overallWinRate.toFixed(1)}%`);
    console.log(`   Total PnL (Cum): ${totalProfit.toFixed(2)}%`);
    return { period: periodName, profit: totalProfit, winRate: overallWinRate };
}

async function main() {
    for (const p of PERIODS) {
        await runBacktest(p.name, p.days);
        await new Promise(r => setTimeout(r, 2000));
    }
}

main();
