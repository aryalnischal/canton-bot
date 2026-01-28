
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load Env
try {
    const envPath = path.resolve('.env.local');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
} catch (e) {
    console.error("No .env.local found");
}

async function purgeLegacy() {
    console.log("🔥 INITIATING LEGACY PURGE (ESM)...");

    const pKey = process.env.HL_PRIVATE_KEY!;
    const walletAddr = process.env.HL_WALLET_ADDRESS!;
    const wallet = new Wallet(pKey);
    // FIX: Single Arg Constructor
    const sdk = new Hyperliquid(wallet);

    // TARGETS: The "Red" Legacy Trades identified in Audit + User Request
    const TARGETS = ['AVAX', 'SUI', 'SEI', 'LINK', 'LDO', 'ARB', 'TIA', 'CRV', 'SOL'];

    try {
        // 1. Fetch Metadata (Asset Universe)
        console.log("Fetching Metadata...");
        const meta = await sdk.info.perpetuals.getMeta();
        const universe = meta.universe;
        const assetMap = new Map();

        // FIX: Normalize keys to short symbol (strip -PERP)
        universe.forEach((u: any, index: number) => {
            const cleanName = u.name.replace("-PERP", "");
            assetMap.set(cleanName, { index, decimals: u.szDecimals, fullName: u.name });
            assetMap.set(u.name, { index, decimals: u.szDecimals, fullName: u.name });
        });

        // MONKEY PATCH: Fix SDK's asset lookup
        (sdk.exchange as any).getAssetIndex = (symbol: string) => {
            const info = assetMap.get(symbol);
            if (!info) throw new Error(`Unknown asset: ${symbol}`);
            return info.index;
        };

        // 2. Fetch Active Positions
        console.log("Fetching active positions...");
        const userState = await sdk.info.perpetuals.getClearinghouseState(walletAddr);
        const active = userState.assetPositions.filter((p: any) => parseFloat(p.position.szi) !== 0);

        if (active.length === 0) {
            console.log("✅ No active positions found.");
            return;
        }

        console.log(`Found ${active.length} active positions.`);

        // 3. Fetch All Mids (for Price)
        const allMids = await sdk.info.getAllMids();
        // DEBUG: Log first key to verify format
        console.log("DEBUG: First Price Key:", Object.keys(allMids)[0]);

        for (const p of active) {
            const coin = p.position.coin; // e.g. "AVAX-PERP"
            let symbol = coin.replace("-PERP", "");

            const positionSize = parseFloat(p.position.szi);

            // Filter
            if (TARGETS.includes(symbol)) {
                console.log(`❌ CLOSING TARGET: ${symbol} (Size: ${positionSize})...`);

                const assetInfo = assetMap.get(symbol);
                if (!assetInfo) {
                    console.error(`   ⚠️ Asset Info not found for ${symbol} or ${coin}`);
                    continue;
                }

                const isBuy = positionSize < 0; // Closing Short = Buy
                const closeSize = Math.abs(positionSize);

                // Get Price
                // FIX: Try both symbol and coin keys
                const midPrice = parseFloat((allMids as any)[symbol] || (allMids as any)[coin] || 0);

                if (midPrice === 0) {
                    console.error(`   ⚠️ No Mid Price for ${symbol} (Tried '${symbol}' and '${coin}')`);
                    continue;
                }

                // Aggressive Limit (Make sure it fills)
                const limitPx = isBuy ? midPrice * 1.05 : midPrice * 0.95;

                // Significant Figures Rounding logic from Engine
                function toSigFigs(n: number, sig: number) {
                    if (n === 0) return 0;
                    const mult = Math.pow(10, sig - Math.floor(Math.log10(Math.abs(n))) - 1);
                    return Math.round(n * mult) / mult;
                }
                const cleanPx = toSigFigs(limitPx, 5);

                const payload = {
                    coin: symbol,
                    is_buy: isBuy,
                    sz: String(closeSize),
                    limit_px: String(cleanPx),
                    order_type: { limit: { tif: 'Ioc' } },
                    reduce_only: true
                };

                try {
                    // FIX: Cast to any
                    const result = await sdk.exchange.placeOrder(payload as any);
                    if (result.status === 'ok') {
                        console.log(`   ✅ Closed ${symbol}: Success (Hash: ${result.response.oid})`);
                    } else {
                        // Check inner errors
                        const statuses = result.response?.data?.statuses || [];
                        if (statuses.length > 0 && statuses[0].error) {
                            console.log(`   ⚠️ Failed (Inner Error):`, statuses[0].error);
                        } else {
                            console.log(`   ⚠️ Failed (API status):`, result);
                        }
                    }

                    // Nap
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err: any) {
                    console.error(`   ⚠️ Failed to close ${symbol}:`, err.message);
                }
            } else {
                console.log(`   🛡️ Skipping ${symbol} (Not in Target List)`);
            }
        }

        console.log("🏁 PURGE COMPLETE.");

    } catch (e) {
        console.error("Purge Error:", e);
    }
}

purgeLegacy();
