
import { runSimulation } from "../lib/backtest-engine";

const CANDIDATES = [
    "SOLUSDT",
    "DOGEUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "PEPEUSDT",
    "BNBUSDT",
    "TRXUSDT"
];

async function main() {
    console.log("Scanning Crypto Market for 'Bitcoin-Like' Profitability...");
    console.log("Criteria: 3-Month Backtest, 5x Leverage, 4H Swing Strategy");
    console.log("----------------------------------------------------------------");
    console.log("| Asset      | Net Profit | Win Rate | Trades | Verdict       |");
    console.log("|------------|------------|----------|--------|---------------|");

    for (const asset of CANDIDATES) {
        try {
            // Test 4H Swing (Standard Bitcoin Startegy)
            const result = await runSimulation(asset, 3, '4h');

            let verdict = "❌ Avoid";
            let color = "\x1b[31m"; // Red

            if (result.netProfit > 50) {
                verdict = "💎 GEM";
                color = "\x1b[32m"; // Green
            } else if (result.netProfit > 20) {
                verdict = "✅ Good";
                color = "\x1b[32m"; // Green
            } else if (result.netProfit > 0) {
                verdict = "⚠️ Okay";
                color = "\x1b[33m"; // Yellow
            }

            const pnlStr = `$${result.netProfit.toFixed(1)}`.padEnd(9);
            const wrStr = `${result.winRate.toFixed(1)}%`.padEnd(7);
            const tradeStr = `${result.totalTrades}`.padEnd(6);

            console.log(`| ${asset.padEnd(10)} | ${color}${pnlStr}\x1b[0m  | ${wrStr}  | ${tradeStr} | ${verdict.padEnd(13)} |`);

        } catch (e) {
            console.log(`| ${asset.padEnd(10)} | ERROR      | 0.0%     | 0      | ❌ Error      |`);
        }
    }
    console.log("----------------------------------------------------------------");
}

main();
