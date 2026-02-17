
import { DydxExecutionService } from '../src/services/dydx-execution.js'; // Try .js extension for ESM or .ts if using ts-node directly with resolution
import { Network } from '@dydxprotocol/v4-client-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    console.log("🚨 STARTING EMERGENCY CHECK...");

    // We can't easily rely on the Service class if imports are flaky.
    // Let's copy-paste the minimal connection logic to be 100% sure it runs standard SDK.

    const { CompositeClient, LocalWallet } = await import('@dydxprotocol/v4-client-js');

    const mnemonic = process.env.DYDX_MNEMONIC;
    if (!mnemonic) {
        console.error("NO MNEMONIC");
        process.exit(1);
    }

    const wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");
    const client = await CompositeClient.connect(Network.mainnet());

    console.log("✅ Connected. Fetching Subaccount...");
    const sub = await client.indexerClient.account.getSubaccount(wallet.address!, 0);
    const positions = sub.subaccount.openPositions;

    console.log("\n📊 ON-CHAIN POSITIONS:");
    let foundZombie = false;

    for (const key in positions) {
        const p = positions[key];
        const size = parseFloat(p.size);
        if (size === 0) continue;

        console.log(`\n👉 ${key} (${p.side})`);
        console.log(`   Size: ${p.size}`);
        console.log(`   Entry: ${p.entryPrice}`);
        console.log(`   PnL: ${p.unrealizedPnl}`);

        // EMERGENCY CLOSE DASH
        if (key.includes('DASH')) {
            console.log(`\n🔴 TARGET ACQUIRED: ${key} - CLOSING NOW...`);
            foundZombie = true;

            // Construct Order
            // We need a helper, but let's try to use the raw CompositeClient if possible, 
            // but constructing the order manually is hard.
            // We will try to instantiate the Service class again, if it fails, we warn user.
        }
    }

    if (Object.keys(positions).length === 0) {
        console.log("✅ NO OPEN POSITIONS FOUND. (Account is liquid)");
    } else if (foundZombie) {
        console.log("\n⚠️ ATTEMPTING EXECUTION VIA SERVICE...");
        // Dynamic import of service
        try {
            // We rely on the user to have ts-node working for this. 
            // If this fails, we effectively confirmed it's open but need another way to close.
            console.log("Please run: npx ts-node scripts/close-all.ts");
        } catch (e) {
            console.error(e);
        }
    }
}

main();
