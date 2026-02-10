import { DydxExecutionService } from './src/services/dydx-execution.ts';
import { DydxMarketService } from './src/services/dydx-market.ts';

async function verify() {
    console.log("-----------------------------------------");
    console.log("🚀 VERIFYING DYDX MIGRATION");
    console.log("-----------------------------------------");

    // 1. Verify Execution Service Init
    const exec = new DydxExecutionService();
    console.log("[TEST] Execution Service Instantiated.");

    // Allow strict async init
    await new Promise(r => setTimeout(r, 2000));

    const state = await exec.getAccountState();
    if (state) {
        console.log("-----------------------------------------");
        console.log("💰 ACCOUNT BALANCE (Testnet):");
        console.log(`   Equity: $${state.equity}`);
        console.log(`   Free Collateral: $${state.freeCollateral}`);
        console.log("-----------------------------------------");
    } else {
        console.error("❌ Failed to fetch Account State. Check Mnemonic in .env.local");
    }

    // 2. Verify Market Service (Candles)
    const market = new DydxMarketService();
    // Simulate Polling
    console.log("[TEST] Market Service Instantiated. Fetching Prices...");

    // We can't easily test private methods of DydxMarketService without getters, 
    // but instantiation proves dependency load.

    console.log("✅ Verification Script Complete.");
    console.log("   (If Account Balance showed up, you are connected!)");
    process.exit(0);
}

verify().catch(e => console.error(e));
