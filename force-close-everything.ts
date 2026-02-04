
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧨 CLOSING ALL POSITIONS...");
    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        for (const p of state.assetPositions) {
            const size = parseFloat(p.position.szi);
            const coin = p.position.coin;
            if (size !== 0) {
                console.log(` - Closing ${coin} (${size})...`);
                let attempts = 0;
                let filled = false;
                while (!filled && attempts < 3) {
                    try {
                        const res = await sdk.exchange.placeOrder({
                            coin: coin,
                            is_buy: size < 0,
                            sz: Math.abs(size),
                            limit_px: 0, // Market
                            order_type: { limit: { tif: 'Gtc' } }, // Default to Gtc to ensure fill if liquidity low
                            reduce_only: true
                        });
                        if (res.status === 'ok') {
                            console.log(`   ✅ Closed ${coin}:`, res.response?.oid);
                            filled = true;
                        } else {
                            console.log(`   ❌ Failed ${coin}:`, res);
                            attempts++;
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    } catch (e) {
                        console.log(`   ⚠️ Exception ${coin}:`, e);
                        attempts++;
                    }
                }
            }
        }
        console.log("✅ Done.");
    } catch (e) {
        console.error("Failed:", e);
    }
}
run();
