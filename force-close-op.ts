
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 CLOSING OP-PERP (-803.5)...");
    try {
        await sdk.info.perpetuals.getMeta();
        
        const allMids = await sdk.info.getAllMids();
        const price = parseFloat(allMids['OP'] || allMids['OP-PERP']);
        console.log(`OP Price: $${price}`);
        
        // Closing SHORT -> BUY -> Higher Limit
        const limitPx = parseFloat((price * 1.20).toFixed(4)); 
        
        console.log(`Placing Buy Limit @ $${limitPx}...`);

        const res = await sdk.exchange.placeOrder({
            coin: 'OP-PERP', // Explicit
            is_buy: true,
            sz: 803.5,
            limit_px: limitPx,
            order_type: { limit: { tif: 'Gtc' } }, // Good Till Cancel
            reduce_only: true
        });
        
        console.log("Result:", JSON.stringify(res, null, 2));

    } catch (e) {
        console.error(e);
    }
}
run();
