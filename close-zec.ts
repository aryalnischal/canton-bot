
import { Hyperliquid } from "hyperliquid";
import { Wallet } from "ethers";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function closeZec() {
    const pKey = process.env.HL_PRIVATE_KEY;
    const address = process.env.HL_WALLET_ADDRESS;
    const wallet = new Wallet(pKey!);
    const sdk = new Hyperliquid(wallet, false);

    console.log("🧨 FORCE CLOSING: ZEC...");

    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(address!);

        console.log(`[DEBUG] Account Value: ${state.marginSummary.accountValue}`);
        console.log(`[DEBUG] Found ${state.assetPositions.length} positions:`);
        state.assetPositions.forEach((p: any) => {
            console.log(`   - ${p.position.coin} (Size: ${p.position.szi})`);
        });

        const pos = state.assetPositions.find((p: any) => p.position.coin === 'ZEC' || p.position.coin.includes('ZEC'));

        if (!pos) {
            console.log("❌ Position not found on-chain.");
            return;
        }

        const size = parseFloat(pos.position.szi);
        if (size === 0) {
            console.log("✅ Position is already closed (Size 0).");
            return;
        }

        console.log(`Found Size: ${size}`);

        const entry = parseFloat(pos.position.entryPx);
        // To FORCE CLOSE (Market), we must cross the spread.
        // If Short (Buy to Close): buy high (1.1).
        // If Long (Sell to Close): sell low (0.9).
        const rawLimit = size < 0 ? entry * 1.1 : entry * 0.9;
        const safeLimit = parseFloat(rawLimit.toFixed(1));

        const res = await sdk.exchange.placeOrder({
            coin: pos.position.coin, // Use exact name from state (e.g. ZEC-PERP)
            is_buy: size < 0, // Invert side to close
            sz: Math.abs(size),
            limit_px: safeLimit,
            order_type: { limit: { tif: 'Gtc' } },
            reduce_only: true
        });

        if (res.status === 'ok') {
            console.log("✅ SUCCESS: CLOSED ZEC.");
            console.log(JSON.stringify(res.response, null, 2));
        } else {
            console.error("❌ FAILED:", res);
        }

    } catch (e) {
        console.error("Execution Error:", e);
    }
}

closeZec();
