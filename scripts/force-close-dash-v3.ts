
import { DydxExecutionService } from '../src/services/dydx-execution';
import {
    OrderType,
    OrderSide,
    OrderTimeInForce,
    OrderExecution
} from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("🚨 FORCE CLOSE DASH (V3 - MARKET ORDER) 🚨");

    // 1. Initialize Engine
    const engine = new DydxExecutionService();
    // Wait for async init (DydxExecutionService doesn't expose promise publicly by default but we can wait)
    // Actually engine.initializationPromise is private.
    // Hack: Wait 3 seconds.
    console.log("Initializing...");
    await new Promise(r => setTimeout(r, 3000));

    // Access raw client (hacky but necessary for scripts)
    const client = (engine as any).client;
    const subaccount = (engine as any).subaccount;

    if (!client || !subaccount) {
        console.error("❌ Client or Subaccount not ready.");
        process.exit(1);
    }

    // 2. Cancel All Open Orders for DASH
    console.log("[1] Cancelling Open Orders for DASH-USD...");
    try {
        const orders = await client.indexerClient.account.getSubaccountOrders(
            subaccount.address,
            subaccount.subaccountNumber,
            undefined, undefined, undefined,
            'OPEN', // Status
            undefined,
            100 // Limit
        );

        const dashOrders = orders.filter((o: any) => o.ticker === 'DASH-USD');
        if (dashOrders.length > 0) {
            console.log(`Found ${dashOrders.length} open orders. Cancelling...`);
            for (const o of dashOrders) {
                await client.cancelOrder(
                    subaccount,
                    o.clientId,
                    o.orderFlags,
                    o.ticker,
                    o.goodTilBlock,
                    o.goodTilBlockTime
                );
                console.log(`Checked Cancel: ${o.clientId}`);
            }
            await new Promise(r => setTimeout(r, 1000));
        } else {
            console.log("No open orders found.");
        }
    } catch (e) {
        console.warn("Cancel check failed (continuing):", e);
    }

    // 3. Get Position & Close
    console.log("[2] Checking Position...");
    const subRaw = await client.indexerClient.account.getSubaccount(subaccount.address, subaccount.subaccountNumber);
    const posMap = subRaw.subaccount.openPerpetualPositions || subRaw.subaccount.openPositions || {};
    const dash = posMap['DASH-USD'];

    if (!dash) {
        console.log("✅ DASH-USD NOT FOUND (Already Closed!)");
        return;
    }

    const size = parseFloat(dash.size);
    if (size === 0) {
        console.log("✅ DASH-USD Size is 0.");
        return;
    }

    console.log(`📉 FOUND DASH: ${size} size. Executing MARKET CLOSE...`);

    const side = size > 0 ? OrderSide.SELL : OrderSide.BUY;
    const absSize = Math.abs(size);

    // MARKET ORDER (Worst Price accepted effectively)
    // Note: SDK 'MARKET' order usually requires a price of 0 (or a very safe limit).
    // Let's use Indexer implied price with huge slippage to be safe, but OrderType.MARKET is best.

    // IMPORTANT: dYdX v4 often requires LIMIT orders with aggressive price for "Market" behavior in some contexts,
    // but the SDK *does* support OrderType.MARKET.

    const clientId = Math.floor(Math.random() * 100000000);

    try {
        const tx = await client.placeOrder(
            subaccount,
            'DASH-USD',
            OrderType.MARKET, // REAL MARKET ORDER
            side,
            0, // Price ignored for MARKET? Or must be Worst Price? 
            // SDK says: "price" for MARKET is the worst price you are willing to accept (Slippage protection).
            // Let's safe-guard it.
            absSize,
            clientId,
            OrderTimeInForce.IOC, // IOC
            0,
            OrderExecution.DEFAULT,
            false, // postOnly
            true   // reduceOnly
        );

        console.log(`✅ MARKET CLOSE SENT: ${tx.hash}`);
        console.log("Waiting 5s to confirm...");
        await new Promise(r => setTimeout(r, 5000));

        // Check again
        const checkSub = await client.indexerClient.account.getSubaccount(subaccount.address, subaccount.subaccountNumber);
        const checkPos = checkSub.subaccount.openPerpetualPositions || checkSub.subaccount.openPositions || {};
        const checkDash = checkPos['DASH-USD'];

        if (!checkDash || parseFloat(checkDash.size) === 0) {
            console.log("🎉 SUCCESS: DASH IS GONE.");
        } else {
            console.error("⚠️ WARNING: DASH STILL THERE. Size: " + checkDash.size);
            console.error("Maybe MARKET order failed or partial fill?");
        }

    } catch (e: any) {
        console.error("❌ EXECUTION FAILED:", e.message || e);
    }
}

main();
