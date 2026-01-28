
import { runSimulation } from './src/lib/backtest-engine.ts';

async function main() {
    console.log("🚀 STARTING MULTI-TIMEFRAME SIMULATION (LIVE DATA)\n");
    console.log("Note: Fetching large datasets from Binance. Please wait...");

    // CONFIGURATION
    const SYMBOL = "BTCUSDT";

    // We simulate duration by changing 'candleLimit'.
    // 1 Week = 168 hours (1h candles)
    // 1 Month = 730 hours
    // 3 Months = 2200 hours
    // 6 Months = 4300 hours
    // 1 Year = 8760 hours
    // 2 Year = 17520 hours (Might hit limits, let's try)

    const tasks = [
        { name: "1 WEEK (Short Term)", limit: 168 },
        { name: "1 MONTH (Medium Term)", limit: 730 },
        { name: "3 MONTHS (Quarterly)", limit: 2200 },
        { name: "6 MONTHS (Half Year)", limit: 4400 },
        { name: "1 YEAR (Long Term)", limit: 8760 }
        // 2 Year skipped to avoid timeout in single script run, can run separately
    ];

    for (const task of tasks) {
        console.log(`\n---------------------------------------------`);
        console.log(`⏳ Testing ${task.name} [Limit: ${task.limit} candles]...`);
        try {
            const report = await runSimulation(SYMBOL, 1, '1h', {
                candleLimit: task.limit,
                initialCapital: 1000,
                tradingSession: 'ALL' // Test 24/7 capability
            });

            console.log(`✅ RESULT for ${task.name}:`);
            console.log(`   Trades: ${report.totalTrades}`);
            console.log(`   Win Rate: ${report.winRate.toFixed(2)}%`);
            console.log(`   Net Profit: $${report.netProfit.toFixed(2)}`);
            console.log(`   Max Drawdown: $${report.maxDrawdown.toFixed(2)}`);

            // Analyze "Why"
            if (report.netProfit > 0) {
                console.log(`   rating: ⭐ PROFITABLE`);
            } else {
                console.log(`   rating: ⚠️ LOSS (Needs Optimization)`);
            }

        } catch (e) {
            console.error(`❌ Failed ${task.name}:`, e);
        }
    }

    console.log("\n---------------------------------------------");
    console.log("🏁 SIMULATION COMPLETE.");
}

main();
