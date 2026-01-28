
const { Hyperliquid } = require('hyperliquid');
console.log("Hyperliquid Export:", Hyperliquid);
const { Wallet } = require('ethers');
const fs = require('fs');
const dotenv = require('dotenv');

// Load Env
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) {
    process.env[k] = envConfig[k];
}

async function closeAll() {
    console.log("☢️  JS EMERGENCY CLOSER  ☢️");

    const pKey = process.env.HL_PRIVATE_KEY;
    const walletAddr = process.env.HL_WALLET_ADDRESS;

    if (!pKey || !walletAddr) {
        console.error("❌ Missing Keys");
        process.exit(1);
    }

    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false); // false = mainnet
    console.log("SDK Keys:", Object.keys(sdk));
    if (sdk.info) {
        console.log("SDK.info Keys:", Object.keys(sdk.info));
        if (sdk.info.perpetuals) console.log("SDK.info.perpetuals Keys:", Object.keys(sdk.info.perpetuals));
        if (sdk.info.spot) console.log("SDK.info.spot Keys:", Object.keys(sdk.info.spot));
    }
    else console.log("SDK.info is missing!");

    try {
        console.log("Fetching State...");
        const userState = await sdk.info.perpetuals.getClearinghouseState(walletAddr);
        const positions = userState.assetPositions;

        const active = positions.filter(p => parseFloat(p.position.szi) !== 0);
        console.log(`Open Positions: ${active.length}`);

        if (active.length === 0) {
            console.log("✅ CLEAN.");
            process.exit(0);
        }

        for (const item of active) {
            const p = item.position;
            const coin = p.coin;
            const szi = parseFloat(p.szi);
            const entry = parseFloat(p.entryPx);
            const isBuy = szi > 0;

            console.log(`Closing ${coin} (${szi})...`);

            const slippage = 0.15; // 15% Slippage for Market Close
            const rawLimitPx = isBuy
                ? entry * (1 - slippage) // Sell lower
                : entry * (1 + slippage); // Buy higher

            // Helper
            function toSigFigs(n, sig) {
                if (n === 0) return 0;
                const mult = Math.pow(10, sig - Math.floor(Math.log10(Math.abs(n))) - 1);
                return Math.round(n * mult) / mult;
            }
            const limitPx = toSigFigs(rawLimitPx, 5);

            const payload = {
                coin: coin,
                is_buy: !isBuy,
                sz: Math.abs(szi),
                limit_px: limitPx,
                order_type: { limit: { tif: 'Ioc' } },
                reduce_only: true
            };

            try {
                const res = await sdk.exchange.placeOrder(payload);
                if (res.status === 'ok') {
                    console.log(`✅ Closed ${coin}`);
                } else {
                    console.error(`❌ Failed ${coin}:`, JSON.stringify(res));
                }
            } catch (err) {
                console.error(`❌ Exception ${coin}:`, err.message);
            }
            // Delay
            await new Promise(r => setTimeout(r, 600));
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

closeAll();
