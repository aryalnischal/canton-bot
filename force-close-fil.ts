
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 CLOSING FIL-PERP (-162.8)...");
    try {
        await sdk.info.perpetuals.getMeta();

        console.log("Fetching Price...");
        const allMids = await sdk.info.getAllMids();
        const price = parseFloat(allMids['FIL'] || allMids['FIL-PERP']);
        console.log(`FIL Price: $${price}`);

        if (!price) throw new Error("Price Failed");

        const rawLimitPx = price * 1.10;
        const limitPx = parseFloat(rawLimitPx.toFixed(4)); // Round to 4 decimals safe

        console.log(`Attempting Place Order (FIL-PERP) @ $${limitPx}...`);
        try {
            const res = await sdk.exchange.placeOrder({
                coin: 'FIL-PERP',
                is_buy: true,
                sz: 162.8,
                limit_px: limitPx,
                order_type: { limit: { tif: 'Ioc' } },
                reduce_only: true
            });
            console.log("Result (FIL-PERP):", JSON.stringify(res, null, 2));
        } catch (e1) {
            console.error("FIL-PERP Failed:", e1);
        }

    } catch (e) {
        console.error(e);
    }
}
run();
