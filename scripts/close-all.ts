
import { DydxExecutionService } from '../src/services/dydx-execution';
import {
    Network,
    IndexerClient,
    OrderStatus,
    OrderType,
    OrderSide,
    OrderTimeInForce,
    OrderExecution
} from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("Initializing Execution Service...");
    const engine = new DydxExecutionService();

    // Wait for init
    await new Promise(r => setTimeout(r, 3000));

    // ---------------------------------------------------------
    // 1. CANCEL ALL OPEN ORDERS
    // ---------------------------------------------------------
    const client = (engine as any).client;
    const subaccount = (engine as any).subaccount;

    // Fetch Markets Globally
    console.log("Fetching Market IDs...");
    const marketsReq = await client.indexerClient.markets.getPerpetualMarkets();
    const marketsRaw = marketsReq.markets;

    if (client && subaccount) {
        try {
            console.log("\n[1/2] Checking for Open Orders (SCORCHED EARTH)...");

            const orders = await client.indexerClient.account.getSubaccountOrders(
                subaccount.address,
                subaccount.subaccountNumber,
                undefined, undefined, undefined,
                undefined, // STATUS: ALL
                undefined, // TYPE
                100        // LIMIT
            );

            const activeOrders = orders.filter((o: any) =>
                o.status !== 'FILLED' &&
                o.status !== 'CANCELED' &&
                o.status !== 'LIQUIDATED'
            );

            if (activeOrders.length > 0) {
                console.log(`Found ${activeOrders.length} Stubborn Orders. Cancelling...`);
                for (const order of activeOrders) {
                    try {
                        const market = marketsRaw[order.ticker];
                        const realClobPairId = market ? market.clobPairId : order.ticker;
                        const gtt = Math.floor(new Date(order.goodTilBlockTime || 0).getTime() / 1000);

                        await client.cancelRawOrder(
                            subaccount,
                            order.clientId,
                            order.orderFlags,
                            realClobPairId,
                            order.goodTilBlock || 0,
                            gtt
                        );
                        console.log(`Cancelled Order ${order.clientId} (${order.ticker})`);
                        await new Promise(r => setTimeout(r, 200));
                    } catch (e: any) {
                        console.log(`Failed to cancel ${order.clientId}:`, e.message);
                    }
                }
            } else {
                console.log("No Active Orders found.");
            }
        } catch (e) {
            console.warn("Failed to check orders:", e);
        }
    }

    // ---------------------------------------------------------
    // 2. CLOSE ALL POSITIONS (Direct SDK)
    // ---------------------------------------------------------
    console.log("\n[2/2] Checking for Open Positions...");
    const subRaw = await client.indexerClient.account.getSubaccount(subaccount.address, subaccount.subaccountNumber);
    const account = subRaw.subaccount;

    const positions = account.openPerpetualPositions || account.openPositions || {};
    const posKeys = Object.keys(positions);

    console.log(`Found ${posKeys.length} Open Positions.`);

    for (const key of posKeys) {
        const p = positions[key];
        const size = parseFloat(p.size);
        if (size === 0) continue;

        const symbol = key;
        const marketInfo = marketsRaw[symbol];
        const oraclePrice = parseFloat(marketInfo.oraclePrice);

        // Aggressive Slippage (20%) to ensure fill
        // For BUY (Close Short): Price * 1.2
        // For SELL (Close Long): Price * 0.8
        const executionPrice = size > 0
            ? oraclePrice * 0.8  // Sell Low (Aggressive)
            : oraclePrice * 1.2; // Buy High (Aggressive)

        // Round executionPrice to valid tick size? 
        // SDK handles validation or we can send raw float for IOC?
        // Let's rely on standard float, or to be safe, exact digits.

        console.log(`Closing ${symbol} (Size: ${size}) at Worst Price ${executionPrice} (Oracle: ${oraclePrice})...`);

        try {
            const side = size > 0 ? OrderSide.SELL : OrderSide.BUY;
            const absSize = Math.abs(size);
            const clientId = Math.floor(Math.random() * 100000000);

            // DIRECT PLACE ORDER
            const tx = await client.placeOrder(
                subaccount,
                symbol,
                OrderType.MARKET,
                side,
                executionPrice, // Aggressive Limit
                absSize, // EXACT SIZE
                clientId,
                OrderTimeInForce.IOC,
                0, // GTT
                OrderExecution.DEFAULT,
                false, // postOnly
                true // reduceOnly
            );

            console.log(`Closed ${symbol}: TX Hash ${tx.hash}`);
            await new Promise(r => setTimeout(r, 1000));
        } catch (e: any) {
            console.error(`Failed to close ${symbol}:`, e.message || e);
        }
    }

    console.log("\nDone. Account Reset.");
}

main();
