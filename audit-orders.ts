
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function getUserOpenOrdersWithRetry(attempts = 1): Promise<any> {
    try {
        return await sdk.info.getUserOpenOrders(wallet.address);
    } catch (e: any) {
        if (attempts <= 5 && (String(e).includes('429') || e?.code === 429)) {
            const delay = Math.pow(2, attempts) * 1000;
            console.warn(`⚠️ Rate Limit (429). Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return getUserOpenOrdersWithRetry(attempts + 1);
        }
        throw e;
    }
}

async function run() {
    console.log("🔍 AUDITING OPEN ORDERS (Robust Mode)...");
    try {
        const orders = await getUserOpenOrdersWithRetry();

        if (orders.length === 0) {
            console.log("⚪ No Open Orders.");
        } else {
            console.log(`🟢 FOUND ${orders.length} OPEN ORDERS:`);
            orders.forEach((o: any) => {
                const isBuy = o.side === 'B';
                const type = o.orderType; // Limit, Trigger, etc.
                const price = parseFloat(o.limitPx);
                const size = parseFloat(o.sz);

                let typeStr = o.orderType;
                let triggerInfo = "";

                if (typeof o.orderType === 'object') {
                    if (o.orderType.trigger) {
                        typeStr = `TRIGGER (${o.orderType.trigger.tpsl})`;
                        triggerInfo = `[Trigger @ $${o.orderType.trigger.triggerPx}]`;
                    } else if (o.orderType.limit) {
                        typeStr = "LIMIT";
                    }
                }

                console.log(`   • ${o.coin} ${isBuy ? 'BUY' : 'SELL'} | ${typeStr} ${triggerInfo}`);
                console.log(`     Size: ${size} @ $${price}`);
                console.log(`     ID: ${o.oid}`);
            });
        }
    } catch (e) {
        console.error("Audit Failed:", e);
    }
}
run();
