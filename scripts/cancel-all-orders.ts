
import {
    CompositeClient,
    LocalWallet,
    Network,
    SubaccountClient
} from '@dydxprotocol/v4-client-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const mnemonic = process.env.DYDX_MNEMONIC;
    const networkType = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();

    if (!mnemonic) {
        console.error("Missing MNEMONIC");
        return;
    }

    const wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");
    const client = await CompositeClient.connect(networkType);
    const subaccount = (SubaccountClient as any).forLocalWallet(wallet, 0);

    console.log(`[DYDX] Cancelling All Orders for: ${wallet.address}`);

    try {

        // 1. Get Open Orders (No Filter Arg to avoid TS issues)
        const response = await client.indexerClient.account.getSubaccountOrders(
            wallet.address as string,
            0 // Subaccount 0
        );

        // Filter for OPEN status manually
        // const orders = response.filter((o: any) => o.status === 'OPEN' || o.status === 'PENDING');
        const orders = response;

        if (orders.length === 0) {
            console.log("✅ No active orders to cancel.");
            return;
        }

        console.log(`Found ${orders.length} active orders. Cancelling...`);

        // 2. Cancel Loop
        for (const o of orders) {
            try {
                // Determine if Short-Term or Long-Term
                // Just use aggressive cancel
                console.log(`Cancelling ${o.id} / ${o.clientId}...`);
                const tx = await client.cancelOrder(
                    subaccount,
                    o.clientId,
                    o.orderFlags,
                    o.ticker,
                    o.goodTilBlock,
                    o.goodTilBlockTime
                );
                // Cast to any to avoid TS errors on return type
                console.log(`Cancelled Order ${o.clientId}: OK`);
            } catch (err) {
                console.error(`Failed to cancel ${o.clientId}:`, err);
            }
        }
        console.log("✅ Cleanup Complete.");

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
