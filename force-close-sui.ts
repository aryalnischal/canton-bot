
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 SDK FORCE CLOSE SUI...");
    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        const pos = state.assetPositions.find((p: any) => p.position.coin === 'SUI');

        if (!pos) {
            console.log("✅ No SUI Position found on-chain.");
            console.log("💰 Margin Summary:", state.marginSummary);
            return;
        }

        const size = parseFloat(pos.position.szi);
        console.log(`⚠️  Found SUI Position: ${size} (${size > 0 ? 'LONG' : 'SHORT'})`);

        if (size === 0) return;

        const isBuy = size < 0; // Close Short -> Buy. Close Long -> Sell.

        const res = await sdk.exchange.placeOrder({
            coin: 'SUI',
            is_buy: isBuy,
            sz: Math.abs(size),
            limit_px: 0, // Market
            order_type: { limit: { tif: 'Ioc' } },
            reduce_only: true
        });

        console.log("Close Result:", res);

    } catch (e) {
        console.error("Force Close Failed:", e);
    }
}
run();
