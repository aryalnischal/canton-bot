
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🚑 EMERGENCY CLOSE DEBUG (OP-PERP)...");
    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        const pos = state.assetPositions.find((p: any) => p.position.coin === 'OP');

        if (!pos) {
            console.log("❌ OP Position NOT FOUND.");
            return;
        }

        const size = parseFloat(pos.position.szi);
        console.log(`📉 Found OP Size: ${size}`);

        if (size === 0) return;

        // Determine Side
        const isBuy = size < 0;
        console.log(`   Action: ${isBuy ? 'BUY' : 'SELL'} to Close.`);

        // 1. Cancel Open Orders on OP first
        const orders = await sdk.info.getUserOpenOrders(wallet.address);
        const opOrders = orders.filter((o: any) => o.coin === 'OP');
        if (opOrders.length > 0) {
            console.log(`   found ${opOrders.length} sticky orders. Cancelling...`);
            for (const o of opOrders) {
                await sdk.exchange.cancelOrder({ coin: 'OP', o: o.oid });
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        // 2. Place Aggressive Market Close
        const res = await sdk.exchange.placeOrder({
            coin: 'OP',
            is_buy: isBuy,
            sz: Math.abs(size),
            limit_px: 0, // Market
            order_type: { limit: { tif: 'Gtc' } }, // Gtc (Good Till Cancel) - Force fit
            reduce_only: true
        });

        console.log("   Order Result:", JSON.stringify(res, null, 2));

        // 3. Verify
        await new Promise(r => setTimeout(r, 2000));
        const state2 = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        const pos2 = state2.assetPositions.find((p: any) => p.position.coin === 'OP');
        const size2 = pos2 ? parseFloat(pos2.position.szi) : 0;
        console.log(`   Final OP Size: ${size2}`);

    } catch (e) {
        console.error("Debug Failed:", e);
    }
}
run();
