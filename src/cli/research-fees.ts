import { runSimulation } from "../lib/backtest-engine";

async function compareFees() {
    console.log("\n🕵️ RESEARCH: WHY DID PROFITABILITY COLLAPSE?");
    console.log("-------------------------------------------");

    // Config
    const asset = 'DOGEUSDT'; // Volatile asset
    const optsBase = {
        leverage: 10,
        stopLoss: 0.02,
        takeProfit: 0.03,
        useMagnets: true,
        initialCapital: 1000,
        candleLimit: 1000 // ~1.5 Months
    };

    console.log(`Test Asset: ${asset} | Leverage: 10x | Capital: $1000\n`);

    // 1. PAPER TRADING (0% Fees)
    console.log("1️⃣  SCENARIO A: 'Paper Trading' (0% Fees)");
    const resA = await runSimulation(asset, 1, '1h', { ...optsBase, feeRate: 0 });
    console.log(`   > Trades: ${resA.totalTrades}`);
    console.log(`   > Net PnL: $${resA.netProfit.toFixed(2)}  (Thinking we are genius)`);
    console.log(`   > Win Rate: ${resA.winRate.toFixed(1)}%\n`);

    // 2. REALITY (0.06% Fees)
    console.log("2️⃣  SCENARIO B: 'Reality' (0.06% Fees per side)");
    const resB = await runSimulation(asset, 1, '1h', { ...optsBase, feeRate: 0.0006 });
    console.log(`   > Trades: ${resB.totalTrades}`);
    console.log(`   > Net PnL: $${resB.netProfit.toFixed(2)}  (Why are we losing?)`);

    // ANALYSIS
    const diff = resA.netProfit - resB.netProfit;
    console.log(`\n📉 THE HIDDEN COST: $${diff.toFixed(2)} lost purely to Fees`);

    if (resA.netProfit > 0 && resB.netProfit < 0) {
        console.log("🚨 CONCLUSION: The Strategy is PROFITABLE before fees, but UNPROFITABLE after fees.");
        console.log("   The 'Loss' isn't bad signals, it's Fee Drag.");
    }
    console.log("-------------------------------------------\n");
}

compareFees();
