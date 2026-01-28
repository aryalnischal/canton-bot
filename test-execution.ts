
import { HyperliquidExecutionService } from './src/services/execution-engine';

// MOCK ENV
process.env.HL_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001"; // Fake Key
process.env.HL_WALLET_ADDRESS = "0x0000000000000000000000000000000000000000";
process.env.MAX_POSITION_SIZE_USD = "50"; // Low Cap
process.env.KILL_SWITCH = "FALSE";

async function runSmokeTest() {
    console.log("🔥 RUNNING SMOKE PRE-FLIGHT TEST 🔥");
    const engine = new HyperliquidExecutionService();

    // TEST 1: Max Limit Check
    console.log("\n[TEST 1] Max Size Guard ($100 vs $50 Cap)");
    const result1 = await engine.executeOrder("BTCUSDT", "BUY", 100, 50000);
    // Expected: Should be Capped at $50 (size 0.001) or Log a warning.
    // The engine implementation explicitly caps it.
    console.log("Result:", result1.success ? "Passed (Executed)" : "Failed (Error)");
    if (result1.filledSize && result1.filledSize * 50000 <= 55) {
        console.log("✅ CAP WORKING: Size capped correctly.");
    } else {
        console.log("❌ CAP FAILED: Size exceeded limit.");
    }

    // TEST 2: Kill Switch
    console.log("\n[TEST 2] Kill Switch Activation");
    process.env.KILL_SWITCH = "TRUE";
    const result2 = await engine.executeOrder("ETHUSDT", "SELL", 20, 3000);
    if (!result2.success && result2.error?.includes("KILL SWITCH")) {
        console.log("✅ KILL SWITCH WORKING: Trade blocked.");
    } else {
        console.log("❌ KILL SWITCH FAILED: Trade went through.", result2);
    }

    // RESET
    process.env.KILL_SWITCH = "FALSE";

    console.log("\n✅ SMOKE TEST COMPLETE");
}

runSmokeTest();
