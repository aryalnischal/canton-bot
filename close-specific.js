
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

const SYMBOL = process.argv[2] ? process.argv[2].toUpperCase().replace("-PERP", "") : null;

if (!SYMBOL) {
    console.error("Usage: node close-specific.js <SYMBOL>");
    process.exit(1);
}

async function closeSpecific() {
    console.log(`🎯 TARGETING: ${SYMBOL}...`);

    const pKey = process.env.HL_PRIVATE_KEY;
    const walletAddr = process.env.HL_WALLET_ADDRESS;

    if (!pKey || !walletAddr) {
        console.error("❌ Missing Keys");
        process.exit(1);
    }

    const wallet = new Wallet(pKey);
    const sdk = new Hyperliquid(wallet, false);

    try {
        const userState = await sdk.info.perpetuals.getClearinghouseState(walletAddr);

        // Robust Matching: Match "ZEC", "ZEC-PERP", "kZEC", etc.
        const position = userState.assetPositions.find(p =>
            p.position.coin === SYMBOL ||
            p.position.coin === `${SYMBOL}-PERP` ||
            p.position.coin.includes(SYMBOL)
        );

        if (!position) {
            console.log(`✅ No position found for ${SYMBOL} (Checked: ${SYMBOL}, ${SYMBOL}-PERP).`);
            console.log("Available Positions:", userState.assetPositions.map(p => p.position.coin).join(", "));
            return;
        }

        const szi = parseFloat(position.position.szi);
        if (szi === 0) {
            console.log(`✅ Position size is 0 for ${SYMBOL}.`);
            return;
        }

        const entry = parseFloat(position.position.entryPx);
        const isBuy = szi > 0;
        console.log(`⚠️ FOUND ${SYMBOL}: Size ${szi} @ ${entry}`);

        // HELPER: Sig Figs
        function toSigFigs(n, sig) {
            if (n === 0) return 0;
            const mult = Math.pow(10, sig - Math.floor(Math.log10(Math.abs(n))) - 1);
            return Math.round(n * mult) / mult;
        }

        // AGGRESSIVE CLOSE
        const slippage = 0.20; // 20% Slippage
        const rawLimitPx = isBuy
            ? entry * (1 - slippage)
            : entry * (1 + slippage);

        const limitPx = toSigFigs(rawLimitPx, 5); // 5 Significant Figures mandated by HL

        console.log(`💥 CLOSING with Limit ${limitPx} (Slippage 20%)...`);
        // 1. FETCH META TO GET ASSET ID
        console.log("Fetching Meta for Asset ID lookup...");
        const meta = await sdk.info.perpetuals.getMeta();
        const universe = meta.universe;

        console.log(`DEBUG: Universe Size ${universe.length}`);

        // SDK adds "-PERP" to names usually. 
        // We accept "ZEC", "ZEC-PERP", or match start.
        const assetIndex = universe.findIndex(u => u.name === SYMBOL || u.name === `${SYMBOL}-PERP`);

        if (assetIndex === -1) {
            console.error(`❌ CRITICAL: ${SYMBOL} not found in Universe Meta.`);
            console.log(`DEBUG: First 5 Assets: ${universe.slice(0, 5).map(u => u.name).join(', ')}`);
            return;
        }

        console.log(`✅ FOUND ${SYMBOL} (Name: ${universe[assetIndex].name}): ID ${assetIndex}`);

        // 2. CONSTRUCT PAYLOAD WITH ASSET ID (Bypass "coin" string lookup)
        // SDK.exchange.placeOrder typically expects { coin: string, ... }
        // BUT we can use the lower-level `postAction` if available, or try to trick the SDK.
        // Actually, the SDK's placeOrder might not support raw asset index.
        // Let's try to update the SDK's internal map if possible? 
        // No, let's look at the `placeOrder` source (it converts coin to assetIndex).
        // IF we pass the asset index directly as `asset` property, maybe it works?

        const payload = {
            coin: universe[assetIndex].name, // Pass "ZEC-PERP" directly?
            is_buy: !isBuy,
            sz: Math.abs(szi),
            limit_px: limitPx,
            order_type: { limit: { tif: 'Ioc' } },
            reduce_only: true
        };

        // Ensure asset ID isn't confused
        // console.log("Payload:", JSON.stringify(payload));

        const res = await sdk.exchange.placeOrder(payload);
        if (res.status === 'ok') {
            console.log(`✅ CLOSED ${SYMBOL}. Response:`, JSON.stringify(res.response));
        } else {
            console.error(`❌ FAILED to close ${SYMBOL}:`, JSON.stringify(res));
        }

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        process.exit(0);
    }
}

closeSpecific();
