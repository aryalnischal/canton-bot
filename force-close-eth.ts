
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 CLOSING ETH-PERP...");
    try {
        await sdk.info.perpetuals.getMeta();

        // Smart Close logic
        const allMids = await sdk.info.getAllMids();
        const price = parseFloat(allMids['ETH'] || allMids['ETH-PERP']);
        console.log(`ETH Price: $${price}`);

        // Reduce Only Market (Limit with Slippage)
        // Closing SHORT -> BUY -> Limit Higher
        const limitPx = parseFloat((price * 1.05).toFixed(1));

        const res = await sdk.exchange.placeOrder({
            coin: 'ETH-PERP', // Explicit
            is_buy: true,
            sz: 0.0774, // Hardcoded from audit
            limit_px: limitPx,
            order_type: { limit: { tif: 'Ioc' } },
            reduce_only: true
        });
        console.log("Result:", JSON.stringify(res, null, 2));

    } catch (e) {
        console.error(e);
    }
}
run();
