import { ethers } from 'ethers';
import { Hyperliquid } from 'hyperliquid';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Helper for rounding to Significant Figures (Match HL API reqs)
function toSigFigs(n: number, sig: number) {
    if (n === 0) return 0;
    const mult = Math.pow(10, sig - Math.floor(Math.log10(Math.abs(n))) - 1);
    return Math.round(n * mult) / mult;
}

async function closeAllPositions() {
    console.log("🦅 STARTING FRESH: Closing ALL Positions...");

    const privateKey = process.env.HL_PRIVATE_KEY;
    const walletAddress = process.env.HL_WALLET_ADDRESS;

    if (!privateKey || !walletAddress) {
        throw new Error("Missing Wallet Config");
    }

    const wallet = new ethers.Wallet(privateKey);
    const hl = new Hyperliquid(wallet);

    // 0. POPULATE ASSET MAP (Fix "Unknown Asset")
    console.log("Fetching Metadata to Fix Asset IDs...");
    const meta = await hl.info.perpetuals.getMeta();
    const assetIdMap = new Map<string, number>();
    meta.universe.forEach((u: any, index: number) => {
        assetIdMap.set(u.name, index);
    });
    console.log(`✅ Loaded ${assetIdMap.size} Asset IDs.`);

    // MONKEY PATCH SDK LOOKUP
    (hl.exchange as any).getAssetIndex = (coin: string) => {
        let id = assetIdMap.get(coin);
        if (id === undefined) id = assetIdMap.get(`${coin}-PERP`);
        if (id === undefined) id = assetIdMap.get(coin.replace("-PERP", ""));

        if (id === undefined) {
            console.error(`UNKNOWN ASSET: ${coin}. Available keys:`, Array.from(assetIdMap.keys()).slice(0, 5));
            throw new Error(`Unknown Asset ID for ${coin}`);
        }
        return id;
    };


    // 1. Fetch Positions via HTTP (Reliable & Typed Correctly)
    console.log("Fetching open positions via API...");
    const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            type: "clearinghouseState",
            user: walletAddress
        })
    });

    if (!res.ok) throw new Error("Failed to fetch positions");
    const state = await res.json();

    // Filter for open positions (size != 0)
    const openPositions = state.assetPositions.filter((p: any) => parseFloat(p.position.szi) !== 0);

    if (openPositions.length === 0) {
        console.log("✅ No open positions found. You are already fresh.");
        return;
    }

    console.log(`⚠️ Found ${openPositions.length} Open Positions. Closing now...`);

    // 2. Loop and Close
    for (const p of openPositions) {
        const coin = p.position.coin;
        const size = parseFloat(p.position.szi);
        const entry = parseFloat(p.position.entryPx);
        const side = size > 0 ? "SELL" : "BUY"; // Reduction Side
        const reduceSize = Math.abs(size);

        console.log(`Closing ${coin}: ${side} ${reduceSize} (Entry: ${entry})`);

        try {
            const rawLimit = side === "BUY" ? entry * 1.1 : entry * 0.9; // 10% Slippage (Safer than 50% for tick size)
            const limitPx = toSigFigs(rawLimit, 5); // 5 Sig Figs is standard HL

            // Place Order via SDK
            const result = await hl.exchange.placeOrder({
                coin: coin,
                is_buy: side === "BUY",
                sz: reduceSize,
                limit_px: limitPx,
                order_type: { limit: { tif: "Gtc" } },
                reduce_only: true
            });

            if (result.status === 'ok') {
                const status = (result.response as any)?.data?.statuses?.[0];
                if (status?.error) {
                    console.error(`❌ Failed to Close ${coin}:`, status.error);
                } else {
                    console.log(`✅ Closed ${coin}`);
                }
            } else {
                console.error(`❌ Failed to Close ${coin}:`, result);
            }

        } catch (e) {
            console.error(`❌ Error Closing ${coin}:`, e);
        }

        // Small delay to prevent seq diff errors
        await new Promise(r => setTimeout(r, 500));
    }

    console.log("🦅 FRESH START COMPLETE.");
}

closeAllPositions().catch(console.error);
