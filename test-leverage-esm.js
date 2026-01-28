
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function testLeverage() {
    const pk = process.env.HL_PRIVATE_KEY;
    const wallet = process.env.HL_WALLET_ADDRESS;

    if (!pk || !wallet) {
        console.error("Missing Keys");
        process.exit(1);
    }

    try {
        // DYNAMIC IMPORT (ESM)
        const { Hyperliquid } = await import('hyperliquid');

        const client = new Hyperliquid(pk, false); // Mainnet

        const COIN = 'AVAX';
        const LEV = 20;

        console.log(`Testing Leverage Update for ${COIN} -> Cross ${LEV}x...`);
        console.log(`Exchange Object Keys:`, Object.keys(client.exchange));

        // CORRECT SIGNATURE: (symbol, "cross", leverage)
        const result = await client.exchange.updateLeverage(COIN, "cross", LEV);

        console.log("✅ Success Result:", JSON.stringify(result, null, 2));

    } catch (e) {
        console.error("❌ FAILURE:", e);
    }
}

testLeverage();
