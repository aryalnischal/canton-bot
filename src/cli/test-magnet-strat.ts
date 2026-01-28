import { runSimulation } from "../lib/backtest-engine";

async function testMagnetStrategy() {
    console.log("\n🧲 TESTING USER STRATEGY: LIQUIDATION MAGNET (FLUSH)");
    console.log("-------------------------------------------");
    console.log("Hypothesis: Price is attracted to 24h Highs/Lows to flush leverage.");
    console.log("Logic: Enter when price is within 2% of High/Low with Momentum.");
    console.log("Target: The High/Low Level.\n");

    // Config
    const asset = 'DOGEUSDT';
    const capital = 2500;
    const optsBase = {
        leverage: 10,
        stopLoss: 0.02,
        takeProfit: 0.05, // We target the level, but safety TP
        initialCapital: 250, // Per Trade
        candleLimit: 1500, // ~2 Months
        feeRate: 0.0006
    };

    // 1. BASELINE (SMA)
    console.log("1️⃣  BASELINE (Old Strategy)...");
    const base = await runSimulation(asset, 2, '1h', { ...optsBase, useLiquidationStrategy: false });
    console.log(`   > Trades: ${base.totalTrades} | Win Rate: ${base.winRate.toFixed(1)}%`);
    console.log(`   > Net Profit: $${base.netProfit.toFixed(2)}`);

    // 2. NEW MIRACLE STRATEGY
    console.log("\n2️⃣  LIQUIDATION MAGNET STRATEGY...");
    const magnet = await runSimulation(asset, 2, '1h', { ...optsBase, useLiquidationStrategy: true });
    console.log(`   > Trades: ${magnet.totalTrades} | Win Rate: ${magnet.winRate.toFixed(1)}%`);
    console.log(`   > Net Profit: $${magnet.netProfit.toFixed(2)}`);

    // COMPARISON
    if (magnet.netProfit > base.netProfit) {
        console.log("\n✅ SUCCESS: User Strategy Outperformed Baseline.");
        const diff = magnet.netProfit - base.netProfit;
        console.log(`   Improvement: +$${diff.toFixed(2)}`);
    } else {
        console.log("\n❌ FAILURE: Strategy did not outperform.");
    }
    console.log("-------------------------------------------\n");
}

testMagnetStrategy();
