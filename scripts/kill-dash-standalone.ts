
import {
    CompositeClient,
    LocalWallet,
    Network,
    OrderExecution,
    OrderSide,
    OrderType,
    OrderTimeInForce
} from '@dydxprotocol/v4-client-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    console.log("🚨 KILL SWITCH: DASH-USD");

    const mnemonic = process.env.DYDX_MNEMONIC;
    if (!mnemonic) { console.error("No MNEMONIC"); process.exit(1); }

    // 1. Setup Client
    const wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");
    const client = await CompositeClient.connect(Network.mainnet());
    console.log(`Address: ${wallet.address}`);

    // 2. Get Position
    const sub = await client.indexerClient.account.getSubaccount(wallet.address || "", 0);
    const positions = sub.subaccount.openPositions;
    const p = positions['DASH-USD'];

    if (!p) {
        console.log("✅ DASH-USD NOT FOUND (Already Closed).");
        return;
    }

    const size = parseFloat(p.size);
    if (size === 0) {
        console.log("✅ DASH-USD Size is 0.");
        return;
    }

    console.log(`📉 FOUND DASH: ${size} size. Closing...`);

    // 3. Execute Close
    // Side is opposite of current position
    const isLong = p.side === 'LONG';
    const side = isLong ? OrderSide.SELL : OrderSide.BUY;
    const price = parseFloat(p.entryPrice) * (isLong ? 0.5 : 1.5); // Aggressive Limit (Market)
    // Reduce Only
    const clientId = Math.floor(Math.random() * 1000000);

    const tx = await client.placeOrder(
        sub.subaccount,
        'DASH-USD',
        OrderType.LIMIT, // 3. Type
        side as any,     // 4. Side
        price,           // 5. Price
        Math.abs(size),  // 6. Size
        clientId,        // 7. ClientID
        OrderTimeInForce.IOC, // 8. TIF
        0,
        OrderExecution.DEFAULT,
        false,
        true
    );

    console.log("✅ CLOSE ORDER SENT.");
    console.log("TX:", tx);
}

main();
