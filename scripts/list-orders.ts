
import {
    BECH32_PREFIX,
    CompositeClient,
    LocalWallet,
    Network
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

    console.log(`[DYDX] Checking Orders for: ${wallet.address}`);

    try {
        const response = await client.indexerClient.account.getSubaccountOrders(
            wallet.address as string,
            0 // Subaccount 0
        );

        const orders = response; // Assuming response is the array or contains it
        if (orders.length === 0) {
            console.log("------------------------------------------------");
            console.log("🔴 NO ACTIVE TP/SL ORDERS FOUND.");
            console.log("------------------------------------------------");
            console.log("The bot handles 'Soft Stops' internally, but Hard Stops should be here.");
        } else {
            console.log("------------------------------------------------");
            console.log(`🟢 FOUND ${orders.length} ACTIVE ORDERS`);
            console.log("------------------------------------------------");
            orders.forEach((o: any) => {
                console.log(`[${o.ticker}] ${o.side} ${o.size} @ ${o.price || 'MARKET'} (${o.type})`);
                console.log(`    Trigger Price: ${o.triggerPrice || 'N/A'}`);
                console.log(`    Expires: ${o.goodTilBlock || 'Never'}`);
            });
        }
    } catch (e) {
        console.error("Error fetching orders:", e);
    }
}

main();
