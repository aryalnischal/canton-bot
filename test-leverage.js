
const { Hyperliquid } = require('hyperliquid');
require('dotenv').config({ path: '.env.local' });

async function testLeverage() {
    const pk = process.env.HL_PRIVATE_KEY;
    const wallet = process.env.HL_WALLET_ADDRESS;

    if (!pk || !wallet) {
        console.error("Missing Keys");
        process.exit(1);
    }

    const clientMain = new Hyperliquid(pk, true); // Try true first?
    // Wait, let's keep it consistent.

    console.log("Client Keys:", Object.keys(clientMain));
    console.log("Client Exchange Keys:", Object.keys(clientMain.exchange));
    console.log("Client Prototype Exchange:", Object.getPrototypeOf(clientMain.exchange));

    const COIN = 'AVAX';
    const LEV = 20;

    try {
        console.log(`Testing Leverage Update for ${COIN} -> Cross ${LEV}x...`);
        const result = await clientMain.exchange.updateLeverage(COIN, true, LEV);
        console.log("✅ Success Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("❌ FAILURE:", e);
    }
}

testLeverage();
