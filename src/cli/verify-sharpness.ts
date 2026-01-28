
import { runSimulation } from "../lib/backtest-engine";

async function main() {
    console.log("Verifying 'Sharpness' (Trend Filter Test)...");
    console.log("-----------------------------------------------------");

    const asset = 'BTCUSDT';

    // Baseline
    const baseline = await runSimulation(asset, 3, '4h', { useTrendFilter: false });
    console.log(`[Baseline] Win Rate: ${baseline.winRate.toFixed(1)}% | Profit: $${baseline.netProfit.toFixed(2)} | Trades: ${baseline.totalTrades}`);

    // Filtered
    const filtered = await runSimulation(asset, 3, '4h', { useTrendFilter: true });
    console.log(`[Filtered] Win Rate: ${filtered.winRate.toFixed(1)}% | Profit: $${filtered.netProfit.toFixed(2)} | Trades: ${filtered.totalTrades}`);

    console.log("-----------------------------------------------------");
    if (filtered.winRate > baseline.winRate) {
        console.log(`✅ SUCCESS: Accuracy improved by +${(filtered.winRate - baseline.winRate).toFixed(1)}%`);
    } else {
        console.log(`❌ FAILURE: Accuracy did not improve.`);
    }
}

main();
