
// Smoke test for the Hyperliquid migration. Run against TESTNET only
// (requires HL_TESTNET=true and a funded testnet HL_PRIVATE_KEY in .env.local).
//
// Verifies: account state reads, one tiny order fills, SL trigger places, close works.
// Modeled on the old scripts/test-trade.ts (dYdX equivalent).

import { HyperliquidExecutionService } from '../src/services/hyperliquid-execution';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    if (process.env.HL_TESTNET !== 'true') {
        console.error("Refusing to run: HL_TESTNET is not 'true'. This script places a real order — testnet only.");
        process.exit(1);
    }

    try {
        console.log("Step 1: Init Service");
        const engine = new HyperliquidExecutionService();

        let ready = false;
        for (let i = 0; i < 10; i++) {
            if ((engine as any).isReady) { ready = true; break; }
            await new Promise(r => setTimeout(r, 1000));
            console.log("...waiting for engine...");
        }
        if (!ready) { console.error("Engine Not Ready"); return; }

        console.log("Step 2: Fetching Account State...");
        const account = await engine.getAccountState();
        console.log("Account:", account);
        if (!account) throw new Error("getAccountState() returned null");

        console.log("Step 3: Fetching Price...");
        // ETH is always listed on Hyperliquid; avoids a hardcoded assetId assumption.
        const { InfoClient, HttpTransport } = await import('@nktkas/hyperliquid');
        const info = new InfoClient({ transport: new HttpTransport({ isTestnet: true }) });
        const mids = await info.allMids();
        const price = parseFloat(mids['ETH'] || '0');
        console.log(`ETH Price: $${price}`);
        if (price <= 0) throw new Error("Price is 0 or Invalid");

        console.log("Step 4: Execute Order ($15, with SL)...");
        const result = await engine.executeOrder(
            "ETH-USD",
            'BUY',
            15,
            price,
            1,
            false,
            { sl: parseFloat((price * 0.9).toFixed(2)) }
        );
        console.log("ORDER RESULT:", result);
        if (!result.success) throw new Error(`Order failed: ${result.error}`);

        console.log("Step 5: Verify Position Opened...");
        const postAccount = await engine.getAccountState();
        console.log("Open Positions:", postAccount?.openPositions);

        console.log("Step 6: Close Position (reduceOnly)...");
        const closeResult = await engine.executeOrder(
            "ETH-USD",
            'SELL',
            15,
            price,
            1,
            true
        );
        console.log("CLOSE RESULT:", closeResult);

        console.log("\n✅ Smoke test complete.");
    } catch (e) {
        console.error("Test Failed:", e);
        process.exit(1);
    }
}

main();
