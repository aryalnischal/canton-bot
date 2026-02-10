import { DydxExecutionService } from '../src/services/dydx-execution';
import { Network, IndexerClient, OrderStatus } from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("Initializing Execution Service...");
    const engine = new DydxExecutionService();

    // Wait for init
    await new Promise(r => setTimeout(r, 3000));

    // 1. Get Open Orders (Triggers)
    const client = (engine as any).client;
    const subaccount = (engine as any).subaccount;

    if (client && subaccount) {
        try {
            // Signature: address, subaccountNumber, ticker, tickerType, side, status
            const ordersResponse = await client.indexerClient.account.getSubaccountOrders(
                subaccount.address,
                subaccount.subaccountNumber,
                undefined, // ticker
                undefined, // tickerType
                undefined, // side
                OrderStatus.OPEN // status
            );

            const orders = ordersResponse; // might be array or object with orders?
            // Actually, response usually has an array. Let's inspect or assume array.
            // Based on other endpoints, it might be `ordersResponse` array directly or `ordersResponse.orders`.
            // Let's assume it returns array of orders based on signature returning Promise<Data>.
            // We'll trust it returns an array or check.

            console.log(`Found ${Array.isArray(orders) ? orders.length : 'unknown'} Open Orders.`);

            if (Array.isArray(orders)) {
                for (const order of orders) {
                    console.log(`Cancelling Order ${order.id || order.clientId}...`);
                    try {
                        await client.cancelOrder(
                            subaccount,
                            order.clientId,
                            order.orderFlags,
                            order.ticker,
                            order.goodTilBlock,
                            order.goodTilBlockTime
                        );
                        console.log("Cancelled.");
                        await new Promise(r => setTimeout(r, 200)); // Pace it
                    } catch (err) {
                        console.log("Cancel failed:", err);
                    }
                }
            } else {
                console.log("Response was not an array of orders:", orders);
            }

        } catch (e: any) {
            console.log("Error fetching/cancelling orders:", e.message || e);
        }
    }

    console.log("Done.");
}

main();
