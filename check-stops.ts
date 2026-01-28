import { ethers } from "ethers";
import * as dotenv from 'dotenv';
import fetch from 'node-fetch'; // Requires 'node-fetch' or global fetch in Node 18+

dotenv.config({ path: '.env.local' });

const HL_API = "https://api.hyperliquid.xyz/info";

async function checkStops() {
    const privateKey = process.env.HL_PRIVATE_KEY;
    if (!privateKey) throw new Error("Missing HL_PRIVATE_KEY");
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;

    console.log(`🔍 INSPECTING ON-CHAIN ORDERS for ${address}...`);

    try {
        // 1. Fetch Open Orders
        const ordersRes = await fetch(HL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ "type": "openOrders", "user": address })
        });
        const openOrders = await ordersRes.json();

        // 2. Fetch User State (Positions)
        const stateRes = await fetch(HL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ "type": "clearinghouseState", "user": address })
        });
        const state = await stateRes.json();
        const positions = state.assetPositions;

        console.log(`\n📊 ACTIVE POSITIONS: ${positions.length}`);

        positions.forEach((p: any) => {
            const coin = p.position.coin;
            const size = parseFloat(p.position.szi);
            const entry = parseFloat(p.position.entryPx);
            const pnl = parseFloat(p.position.unrealizedPnl);

            // Check if covered by a Trigger Order
            // Trigger orders are tricky: Standard 'openOrders' endpoint returns Limit orders.
            // Triggers (TP/SL) might be in the same list with orderType='Trigger' OR different endpoint?
            // On Hyperliquid, 'openOrders' returns ALL active orders including Trigger orders if configured correctly?
            // Actually, triggers are separate. We should check.

            // Wait, Hyperliquid API docs say 'openOrders' returns active Limit orders.
            // Does it include TP/SL? 
            // If they are triggers, they might not show up here unless triggered?
            // No, Stop Loss is an open order.

            // Let's filter orders for this coin
            const coinOrders = (openOrders as any[]).filter((o: any) => o.coin === coin);
            const hasStop = coinOrders.some((o: any) =>
                (o.orderType === 'Trigger' || o.orderType.trigger || o.sz === '0' /* potentially */) && o.side !== (size > 0 ? 'B' : 'A') // Opposite side
            );

            // Simplified check: Just show orders
            const ordersSummary = coinOrders.map(o => `${o.side} ${o.sz} @ ${o.limitPx} (${JSON.stringify(o.orderType)})`).join(", ");

            const status = ordersSummary.length > 0 ? "🛡️ PROTECTED" : "⚠️ NAKED";

            console.log(`- ${coin}: ${size} @ $${entry} (PnL: ${pnl.toFixed(2)}) -> ${status} [${ordersSummary}]`);
        });

        console.log(`\n📦 TOTAL OPEN ORDERS: ${(openOrders as any[]).length}`);
        (openOrders as any[]).forEach(o => {
            console.log(`  > ${o.coin} ${o.side} ${o.sz} @ ${o.limitPx} [${JSON.stringify(o.orderType)}]`);
        });

    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

checkStops().catch(console.error);
