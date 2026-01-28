
import { HyperliquidExecutionService } from './src/services/execution-engine';
import { logger } from './src/lib/logger';
import dotenv from 'dotenv';

// Load Env
dotenv.config({ path: '.env.local' });

async function runVerifiedTrade() {
    console.log("🔍 STARTING DIAGNOSTIC TRADE...");
    console.log(`Wallet: ${process.env.HL_WALLET_ADDRESS}`);

    if (!process.env.HL_PRIVATE_KEY) {
        console.error("❌ NO PRIVATE KEY FOUND");
        process.exit(1);
    }

    const engine = new HyperliquidExecutionService();

    // Wait for init
    await new Promise(r => setTimeout(r, 2000));

    console.log("🚀 Executing Test Trade: BUY AVAX ($15 USD size)...");

    // Force a small trade
    // AVAX is usually ~30-40 USD. Size 15 USD = ~0.5 AVAX.
    // If < $10, HL might reject. Let's try $12.
    const result = await engine.executeOrder(
        "AVAX",
        "BUY",
        12, // Size USD
        30.0, // Approx Price (Will be used for limit calc)
        1 // Leverage
    );

    console.log("\n💡 EXECUTION RESULT:");
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
        console.log("✅ TRADE SUCCESSFUL! Check Dashboard.");
    } else {
        console.error("❌ TRADE FAILED:", result.error);
    }

    process.exit(0);
}

runVerifiedTrade().catch(e => {
    console.error("CRITICAL CRASH:", e);
    process.exit(1);
});
