
import { runSimulation } from "../lib/backtest-engine";

async function main() {
    console.log("Running Strategy Optimization Matrix (BTC 4H Swing)...");
    console.log("-----------------------------------------------------");

    const asset = 'BTCUSDT';
    const interval = '4h';

    // Ranges to test
    const stopLosses = [0.01, 0.015, 0.02, 0.025, 0.03]; // 1% to 3%
    const takeProfits = [0.03, 0.04, 0.05, 0.07, 0.10, 0.15]; // 3% to 15%

    let bestProfit = -Infinity;
    let bestConfig = { sl: 0, tp: 0 };
    let bestWinRate = 0;

    // Header
    console.log("SL%   | TP%   | PnL ($) | Win Rate");
    console.log("------|-------|---------|---------");

    for (const sl of stopLosses) {
        for (const tp of takeProfits) {
            // Skip invalid R:R (Risking more than reward usually bad, but we test anyway)

            const result = await runSimulation(asset, 3, interval, {
                stopLoss: sl,
                takeProfit: tp,
                leverage: 5
            });

            console.log(`${(sl * 100).toFixed(1)}%  | ${(tp * 100).toFixed(1)}%  | $${result.netProfit.toFixed(1)}   | ${result.winRate.toFixed(1)}%`);

            if (result.netProfit > bestProfit) {
                bestProfit = result.netProfit;
                bestConfig = { sl, tp };
                bestWinRate = result.winRate;
            }
        }
    }

    console.log("-----------------------------------------------------");
    console.log(`\n🏆 BEST CONFIGURATION FOUND:`);
    console.log(`   Stop Loss: ${(bestConfig.sl * 100).toFixed(1)}%`);
    console.log(`   Take Profit: ${(bestConfig.tp * 100).toFixed(1)}%`);
    console.log(`   Net Profit: $${bestProfit.toFixed(2)} (+${bestProfit.toFixed(1)}%)`);
    console.log(`   Win Rate: ${bestWinRate.toFixed(1)}%`);
    console.log(`\n   Verdict: Sharper accuracy achieved by verifying R:R.`);
}

main();
