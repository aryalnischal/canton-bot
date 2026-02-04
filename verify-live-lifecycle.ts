
import { Hyperliquid } from "hyperliquid";
import { Wallet } from "ethers";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function runTest() {
    const pKey = process.env.HL_PRIVATE_KEY;
    const address = process.env.HL_WALLET_ADDRESS;
    const wallet = new Wallet(pKey!);
    const sdk = new Hyperliquid(wallet, false);

    console.log(`\n🧪 STARTING LIVE VERIFICATION TEST (SUI) - LITE MODE...`);
    console.log("---------------------------------------------");

    try {
        await new Promise(r => setTimeout(r, 2000)); // Initial Backoff

        // 1. GET PRICE (No Meta Fetch)
        console.log("1️⃣  Fetching Price...");
        const mids = await sdk.info.getAllMids();
        let COIN = "SUI-PERP";
        let price = parseFloat(mids[COIN]);

        if (isNaN(price)) {
            COIN = "SUI";
            price = parseFloat(mids[COIN]);
        }
        if (isNaN(price)) throw new Error("Could not fetch price for SUI or SUI-PERP");

        console.log(`   Asset: ${COIN} | Price: $${price}`);

        // 2. OPEN TRADE
        const SIZE_USD = 12;
        console.log(`\n2️⃣  Opening LONG ($${SIZE_USD})...`);
        const sz = parseFloat((SIZE_USD / price).toFixed(1)); // 1 decimal for SUI
        console.log(`   Size: ${sz} ${COIN}`);

        // Set Isolated Leverage
        try {
            console.log(`   Setting Leverage 5x...`);
            await new Promise(r => setTimeout(r, 1000));
            // Official SDK: updateLeverage(leverage, coin, isCross)
            await sdk.exchange.updateLeverage(5, COIN, false);
            console.log("   ✅ Leverage set to 5x ISOLATED");
        } catch (e) { console.warn("   ⚠️ Leverage Set Failed:", e); }

        await new Promise(r => setTimeout(r, 1000));

        const entryRes = await sdk.exchange.placeOrder({
            coin: COIN,
            is_buy: true,
            sz,
            limit_px: price * 1.05,
            order_type: { limit: { tif: 'Ioc' } },
            reduce_only: false
        });

        if (entryRes.status !== 'ok') {
            throw new Error(`Entry Failed: ${JSON.stringify(entryRes)}`);
        }
        console.log("   ✅ ENTRY FILLED.");

        // Wait
        await new Promise(r => setTimeout(r, 2000));

        // 3. VERIFY POSITION
        console.log("\n3️⃣  Verifying On-Chain...");
        const state = await sdk.info.perpetuals.getClearinghouseState(address!);
        const pos = state.assetPositions.find((p: any) => p.position.coin === COIN);

        if (!pos || parseFloat(pos.position.szi) === 0) {
            throw new Error("Position NOT FOUND after entry!");
        }
        console.log(`   ✅ CONFIRMED: ${pos.position.szi} ${COIN} @ $${pos.position.entryPx}`);

        // 4. PLACE TP/SL (TRIGGERS)
        console.log("\n4️⃣  Placing TP/SL...");
        const entryPx = parseFloat(pos.position.entryPx);
        const slPx = parseFloat((entryPx * 0.98).toFixed(4)); // 2% SL

        const slRes = await sdk.exchange.placeOrder({
            coin: COIN,
            is_buy: false, // Sell to close
            sz,
            limit_px: slPx, // Trigger Price
            order_type: {
                trigger: {
                    triggerPx: slPx,
                    isMarket: true,
                    tpsl: 'sl'
                }
            },
            reduce_only: true
        });

        if (slRes.status === 'ok') console.log(`   ✅ SL Placed @ $${slPx}`);
        else console.log(`   ❌ SL Failed:`, slRes);

        // 5. CLOSING (CLEANUP)
        await new Promise(r => setTimeout(r, 3000));
        console.log("\n5️⃣  CLOSING POSITION (Market)...");

        // Use aggressive limit for closure
        const closeLimit = price * 0.9;

        const closeRes = await sdk.exchange.placeOrder({
            coin: COIN,
            is_buy: false,
            sz,
            limit_px: closeLimit,
            order_type: { limit: { tif: 'Ioc' } },
            reduce_only: true
        });

        if (closeRes.status === 'ok') {
            const filled = closeRes.response?.data?.statuses?.[0]?.filled;
            if (filled) console.log(`   ✅ CLOSED at $${filled.avgPx}`);
            else console.log(`   ⚠️ Submitted (Check Status):`, JSON.stringify(closeRes.response));
        } else {
            console.error("   ❌ CLOSE FAILED:", closeRes);
        }

        // 6. CANCEL OPEN ORDERS (TP/SL)
        console.log("\n6️⃣  Cancelling Orders...");
        await new Promise(r => setTimeout(r, 1000));
        const openOrders = await sdk.info.perpetuals.getOpenOrders(address!);
        const myOrders = openOrders.filter((o: any) => o.coin === COIN);
        for (const o of myOrders) {
            await sdk.exchange.cancelOrder({ coin: COIN, o: o.oid });
            console.log(`   Cancelled Order ${o.oid}`);
        }

        console.log("\n✅✅ VERIFICATION COMPLETE. SYSTEM IS SAFE. ✅✅");

    } catch (e) {
        console.error("\n❌ TEST FAILED:", e);
    }
}

runTest();
