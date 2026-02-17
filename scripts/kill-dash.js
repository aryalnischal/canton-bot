
const {
    CompositeClient,
    LocalWallet,
    Network,
    OrderExecution,
    OrderSide,
    OrderType,
    OrderTimeInForce,
    SubaccountClient
} = require('@dydxprotocol/v4-client-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

async function main() {
    console.log("🚨 KILL SWITCH (JS - FIXED): DASH-USD");

    const mnemonic = process.env.DYDX_MNEMONIC;
    if (!mnemonic) { console.error("No MNEMONIC"); process.exit(1); }

    // 1. Setup Wallet & Client
    console.log("Connecting...");
    // Force 'dydx' prefix
    const wallet = await LocalWallet.fromMnemonic(mnemonic, "dydx");
    console.log(`Address: ${wallet.address}`);

    const client = await CompositeClient.connect(Network.mainnet());

    // 2. Setup Subaccount Client (Crucial for Signing)
    const subaccount = SubaccountClient.forLocalWallet(wallet, 0);

    // 3. Get Position
    const sub = await client.indexerClient.account.getSubaccount(wallet.address, 0);
    // Fix: Field name is openPerpetualPositions
    const positions = sub.subaccount.openPerpetualPositions || sub.subaccount.openPositions || {};
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

    // 4. Execut Close
    const isLong = p.side === 'LONG';
    const side = isLong ? OrderSide.SELL : OrderSide.BUY;
    // Aggressive Limit (Market)
    const price = parseFloat(p.entryPrice) * (isLong ? 0.5 : 1.5);

    const clientId = Math.floor(Math.random() * 1000000);

    console.log(`Sending Order: ${side} ${Math.abs(size)} @ ${price}`);

    const tx = await client.placeOrder(
        subaccount, // Pass the SubaccountClient with the wallet attached!
        'DASH-USD',
        OrderType.LIMIT,
        side,
        price,
        Math.abs(size),
        clientId,
        OrderTimeInForce.IOC,
        0,
        OrderExecution.DEFAULT,
        false,
        true   // ReduceOnly
    );

    console.log("✅ CLOSE ORDER SENT.");
    console.log("TX Hash:", tx.hash);
}

main().catch(console.error);
