
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    try {
        console.log("🔍 AUDITING OPEN ORDERS...");
        const orders = await sdk.info.getUserOpenOrders(wallet.address);

        if (orders.length === 0) {
            console.log("✅ No Open Orders.");
        } else {
            console.log(`📌 Found ${orders.length} Open Orders:`);
            orders.forEach((o: any) => {
                const type = o.orderType.trigger ? `TRIGGER (${o.orderType.trigger.tpsl})` : 'LIMIT';
                const px = o.limitPx || o.orderType.trigger.triggerPx;
                console.log(` - ${o.coin} ${o.side} ${o.sz} @ $${px} [${type}] (ReduceOnly: ${o.reduceOnly})`);
            });
        }
    } catch (e) {
        console.error("Audit Failed:", e);
    }
}

run();
