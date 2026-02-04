
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 CANCELLING ALL OPEN ORDERS...");
    try {
        const orders = await sdk.info.getUserOpenOrders(wallet.address);
        console.log(`Found ${orders.length} orders.`);

        for (const o of orders) {
            console.log(` - Cancelling ${o.coin} OID: ${o.oid}`);
            const res = await sdk.exchange.cancelOrder({
                coin: o.coin,
                o: o.oid
            });
            console.log("   Result:", res.status);
            await new Promise(r => setTimeout(r, 200));
        }

    } catch (e) {
        console.error("Cancel Loop Failed:", e);
    }
}
run();
