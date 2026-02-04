
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🧹 CLEANING DUST POSITIONS...");

    // Hardcoded for safety: only close OP and ARB
    const targets = ['OP', 'ARB'];
    const positions = [
        { coin: 'OP', size: -0.2 },
        { coin: 'ARB', size: -2.9 }
    ];

    for (const t of positions) {
        console.log(`Closing ${t.coin} (${t.size})...`);
        try {
            const res = await sdk.exchange.placeOrder({
                coin: t.coin,
                is_buy: t.size < 0, // Buy to Close Short
                sz: String(Math.abs(t.size)),
                limit_px: "1000", // Aggressive Limit (Buy High)
                order_type: { limit: { tif: 'Gtc' } },
                reduce_only: true
            });
            console.log("Result:", res.status === 'ok' ? 'Success' : JSON.stringify(res));
        } catch (e) {
            console.error("Failed:", e);
        }
    }
}
run();
