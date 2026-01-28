import { runSimulation } from "../lib/backtest-engine";

async function projectProfitability() {
    console.log("\n🚀 PROJECTING PROFITABILITY: $2,500 CAPITAL");
    console.log("-------------------------------------------");
    console.log("Assumption: 10 Trades max, so $250 per trade.");
    console.log("Leverage: 10x (Pro Mode)");
    console.log("Timeframe: 1 Month (approx 720 hours)\n");

    const capitalPerTrade = 250;
    const options = {
        leverage: 10,
        stopLoss: 0.02,
        takeProfit: 0.03, // 1.5:1 R:R
        useMagnets: true,
        initialCapital: capitalPerTrade,
        candleLimit: 720 // ~1 Month
    };

    const assets = ['DOGEUSDT', 'SOLUSDT', 'BTCUSDT'];
    let totalProjectedPnL = 0;

    for (const asset of assets) {
        console.log(`Analyzing ${asset}...`);
        const result = await runSimulation(asset, 1, '1h', options);

        // PnL is per trade unit ($250). Result.netProfit is total profit on that unit.
        // We assume we are trading these concurrently or rotating capital.
        // Let's summing them up as if we had buckets for each.

        console.log(`  > Trades: ${result.totalTrades} | Win Rate: ${result.winRate.toFixed(1)}%`);
        console.log(`  > Net PnL (on $250): $${result.netProfit.toFixed(2)}`);

        totalProjectedPnL += result.netProfit;
    }

    console.log("\n-------------------------------------------");
    console.log(`💰 PROJECTED MONTHLY PnL: $${totalProjectedPnL.toFixed(2)}`);
    console.log(`📈 ROI on $2,500: ${((totalProjectedPnL / 2500) * 100).toFixed(2)}%`);
    console.log("-------------------------------------------\n");
}

projectProfitability();
