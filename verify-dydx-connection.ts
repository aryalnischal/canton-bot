
import { DydxExecutionService } from './src/services/dydx-execution';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("--- dYdX Connection Verification ---");

    // Check Env
    if (!process.env.DYDX_MNEMONIC && !process.env.DYDX_PRIVATE_KEY) {
        console.error("❌ Stats: FAILED. Missing DYDX credentials in .env.local");
        process.exit(1);
    }

    console.log(`Network: ${process.env.DYDX_NETWORK || 'TESTNET (Default)'}`);
    console.log(`Validator: ${process.env.DYDX_VALIDATOR || 'Default'}`);

    const engine = new DydxExecutionService();

    // Wait for init
    console.log("Initializing Service...");
    await new Promise(r => setTimeout(r, 2000));

    try {
        console.log("Fetching Account State...");
        const state = await engine.getAccountState();

        if (state) {
            console.log("✅ Connection Successful!");
            console.log("--- Account Summary ---");
            console.log(`Address: ${state.address}`);
            console.log(`Equity: $${parseFloat(state.equity).toFixed(2)}`);
            console.log(`Free Collateral: $${parseFloat(state.freeCollateral).toFixed(2)}`);

            const positionKeys = Object.keys(state.openPositions);
            console.log(`Open Positions: ${positionKeys.length}`);
            if (positionKeys.length > 0) {
                positionKeys.forEach(key => {
                    const pos = state.openPositions[key];
                    console.log(`- ${key}: ${pos.size} (Entry: ${pos.entryPrice})`);
                });
            }
        } else {
            console.error("❌ Failed to fetch account state (returned null). Check logs.");
        }

    } catch (e) {
        console.error("❌ Verification Error:", e);
    }
}

main();
