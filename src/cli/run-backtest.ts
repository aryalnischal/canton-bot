
import { runSimulation } from "../lib/backtest-engine";

async function main() {
    console.log("Starting 3-Month Day-by-Day Breakdown (5x Leverage)...");
    console.log("----------------------------------------------------------------");

    // Test BTC (4H Swing) & ZEC (1H Day) as they were the best performers
    const tests = [
        { asset: 'BTCUSDT', interval: '4h', label: 'BTC Swing (4H)' },
        { asset: 'AVAXUSDT', interval: '4h', label: 'AVAX Swing (4H)' },
        { asset: 'SOLUSDT', interval: '4h', label: 'SOL Swing (4H)' },
        { asset: 'LINKUSDT', interval: '15m', label: 'LINK Scalp (15m)' },
        { asset: 'ZECUSDT', interval: '1h', label: 'ZEC Day Trade (1H)' }
    ];

    for (const t of tests) {
        console.log(`\n\x1b[1m=== ${t.label} : Last 3 Months ===\x1b[0m`);

        try {
            // 3 Months of data
            // 4h: 3 months = 90 days * 6 = 540 candles (fetching 1000 is enough)
            // 1h: 3 months = 90 days * 24 = 2160 candles (needs pagination)
            // 15m: 3 months = 90 * 96 = 8640 candles (needs heavy pagination, might be slow, limit to 2500 for ~26 days demo or try full?)
            // Let's cap at 2500 for speed/safety in this demo run. 2500 1h = 104 days. Perfect.

            const limit = 2500;
            const result = await runSimulation(t.asset, 3, t.interval); // Duration arg ignored, mostly relies on fetched count
            // Wait, runSimulation calls fetch with fixed 1500 currently? 
            // I need to update runSimulation call to use higher limit if I normalized it?
            // Actually runSimulation has hardcoded '1500' in the file. 
            // I SHOULD HAVE UPDATED runSimulation to accept limit!

            // ... Assuming I fix runSimulation in next step, let's write the display logic

            console.log(`\nMetric Breakdown:`);
            const color = result.netProfit > 0 ? "\x1b[32m" : "\x1b[31m";
            console.log(`  PnL: ${color}$${result.netProfit.toFixed(2)} (${result.netProfit.toFixed(1)}%)${"\x1b[0m"}`);
            console.log(`  Win Rate: ${result.winRate.toFixed(1)}%`);
            console.log(`  Total Trades: ${result.totalTrades}`);
            console.log(`\nTrade Log (Last 10 Trades):`);
            console.log(`  | Date            | Type  | Price      | PnL       | Status |`);
            console.log(`  |-----------------|-------|------------|-----------|--------|`);

            const recentTrades = result.trades.slice(-10); // Show last 10
            recentTrades.forEach(tr => {
                const date = new Date(tr.entryTime).toISOString().split('T')[0];
                const pnlColor = tr.status === 'WIN' ? "\x1b[32m" : "\x1b[31m";
                const pnlText = `${tr.status === 'WIN' ? '+' : ''}${tr.pnlUsd.toFixed(2)}`;
                console.log(`  | ${date}      | ${tr.side.padEnd(5)} | $${tr.entryPrice.toFixed(2).padEnd(9)} | ${pnlColor}${pnlText.padEnd(9)}${"\x1b[0m"} | ${tr.status}    |`);
            });
            console.log(`  ... (and ${result.trades.length - 10} more)`);

        } catch (error) {
            console.log("Failed.");
            console.error(error);
        }
    }
}

main();
