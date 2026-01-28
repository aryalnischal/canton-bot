
const { Hyperliquid } = require('hyperliquid');
const { Wallet } = require('ethers');
const fs = require('fs');
const dotenv = require('dotenv');

// Load Env
try {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

async function checkPositions() {
    console.log("🔍 INSPECTING ON-CHAIN POSITIONS...");

    const pKey = process.env.HL_PRIVATE_KEY;
    const walletAddr = process.env.HL_WALLET_ADDRESS;

    if (!pKey || !walletAddr) {
        console.error("❌ Missing Keys");
        process.exit(1);
    }

    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false); // Mainnet

    try {
        const [userState, openOrders] = await Promise.all([
            sdk.info.perpetuals.getClearinghouseState(walletAddr),
            sdk.info.getUserOpenOrders(walletAddr)
        ]);

        // 1. ORDERS
        if (openOrders.length > 0) {
            console.log(`⚠️  ${openOrders.length} OPEN ORDERS DETECTED:`);
            console.table(openOrders.map((o: any) => ({
                coin: o.coin,
                side: o.side,
                sz: o.sz,
                px: o.limitPx,
                tif: o.tif,
                oid: o.oid
            })));
        } else {
            console.log("✅ No Open Orders.");
        }

        // 2. POSITIONS
        const active = userState.assetPositions.filter((p: any) => parseFloat(p.position.szi) !== 0);

        if (active.length === 0) {
            console.log("✅ NO ACTIVE POSITIONS FOUND.");
            fs.writeFileSync('positions.json', JSON.stringify({ active: [], orders: openOrders, count: 0, status: "CLEAN" }, null, 2));
        } else {
            console.log(`⚠️  FOUND ${active.length} ACTIVE POSITIONS:`);
            const slim = active.map((p: any) => ({
                Symbol: p.position.coin,
                Size: p.position.szi,
                Entry: parseFloat(p.position.entryPx).toFixed(4),
                LevType: p.position.leverage.type,
                LevVal: p.position.leverage.value,
                PnL: p.position.unrealizedPnl
            }));
            console.table(slim);
            fs.writeFileSync('positions.json', JSON.stringify({ active: slim, orders: openOrders, count: active.length, status: "DIRTY" }, null, 2));
        }

    } catch (e: any) {
        console.error("Fetch Error:", e.message);
        fs.writeFileSync('positions.json', JSON.stringify({ error: e.message }, null, 2));
    }
}

checkPositions();
