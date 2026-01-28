
import { Hyperliquid } from 'hyperliquid';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testLeverage() {
    const pk = process.env.HL_PRIVATE_KEY;
    const wallet = process.env.HL_WALLET_ADDRESS;

    if (!pk || !wallet) {
        console.error("Missing Keys");
        process.exit(1);
    }

    const sdk = new Hyperliquid(pk, true); // true = Testnet? No, User is Mainnet? 
    // Wait, previous code used false (Mainnet). Let's check env.
    // If user provided PK for Mainnet, we must use Mainnet.
    // Assuming Mainnet based on previous 'close-all.js' using `false`.

    // SDK Constructor: (privateKey, testnet bool)
    const client = new Hyperliquid(pk, false);

    const COIN = 'AVAX'; // Test with AVAX as user had issues there
    const LEV = 20;

    try {
        console.log(`Testing Leverage Update for ${COIN} -> Cross ${LEV}x...`);

        // hyperliquid-ts signature: updateLeverage(coin, isCross, leverage)
        const result = await client.exchange.updateLeverage(COIN, true, LEV);

        console.log("✅ Success Result:", JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.error("❌ FAILURE:", e);
        console.error("Message:", e.message);
    }
}

testLeverage();
