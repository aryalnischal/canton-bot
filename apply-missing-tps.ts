
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

const MAX_RETRIES = 5;

// HELPER: Exponential Retry
async function retry<T>(fn: () => Promise<T>, name: string): Promise<T | null> {
    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            return await fn();
        } catch (e: any) {
            if (String(e).includes('429') || e?.code === 429) {
                const delay = Math.pow(2, i) * 1000;
                console.warn(`⚠️ [${name}] Rate Limit (429). Retry ${i}/${MAX_RETRIES} in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                console.error(`❌ [${name}] Error:`, e.message);
                return null;
            }
        }
    }
    console.error(`❌ [${name}] Failed after ${MAX_RETRIES} attempts.`);
    return null;
}

// MAIN LOGIC
async function run() {
    console.log("🛠️ REPAIRING MISSING TAKE PROFITS (Precision Aware)...");

    // 0. Fetch Metadata for Decimals
    const meta = await retry(() => sdk.info.perpetuals.getMeta(), "Fetch Metadata");
    if (!meta) return;

    // Create Map: Coin -> szDecimals
    const decimalMap = new Map<string, number>();
    meta.universe.forEach((u: any) => {
        decimalMap.set(u.name, u.szDecimals);
    });
    console.log(`✅ Loaded Metadata for ${decimalMap.size} assets.`);

    // 1. Get Positions
    const state = await retry(() => sdk.info.perpetuals.getClearinghouseState(wallet.address), "Fetch Positions");
    if (!state) return;

    const positions = state.assetPositions.filter((p: any) => parseFloat(p.position.szi) !== 0);

    if (positions.length === 0) {
        console.log("✅ No Active Positions to Repair.");
        return;
    }

    // 2. Get Open Orders
    const orders = await retry(() => sdk.info.getUserOpenOrders(wallet.address), "Fetch Orders");
    if (!orders) return;

    for (const p of positions) {
        const pos = p.position;
        const coin = pos.coin;
        const size = parseFloat(pos.szi);
        const entry = parseFloat(pos.entryPx);
        const isLong = size > 0;

        // Resolve Precision
        const szDecimals = decimalMap.get(coin) ?? 2; // Default 2 if missing

        console.log(`\n🔍 Checking ${coin} (${isLong ? 'LONG' : 'SHORT'} ${size}) [Decimals: ${szDecimals}]...`);

        // Check for Existing TPs
        const existingTPs = orders.filter((o: any) =>
            o.coin === coin &&
            o.orderType?.trigger?.tpsl === 'tp'
        );

        if (existingTPs.length >= 2) {
            console.log(`   ✅ Has ${existingTPs.length} Active TP Orders. Healthy.`);
            continue;
        }

        console.log(`   ⚠️ FOUND ${existingTPs.length} TP ORDERS (Expected 3). Repairing...`);

        const direction = isLong ? 1 : -1;
        const layers = [
            { pct: 0.25, gain: 0.05 },
            { pct: 0.25, gain: 0.12 },
            { pct: 0.50, gain: 0.30 }
        ];

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const targetPrice = entry * (1 + (layer.gain * direction));
            const layerSizeRaw = Math.abs(size) * layer.pct;

            // CORRECT ROUNDING
            const power = Math.pow(10, szDecimals);
            const layerSize = Math.floor(layerSizeRaw * power) / power;

            if (layerSize <= 0) continue;

            // Check Minimum Value (~$11)
            const estimatedValue = layerSize * entry;
            if (estimatedValue < 11) {
                console.log(`      ⚠️ Skipping TP${i + 1}: Size Too Small ($${estimatedValue.toFixed(2)} < $11)`);
                continue;
            }

            const priceStr = targetPrice.toFixed(4); // Price decimals usually 4-5, verify if needed but 4 safe for most.
            console.log(`   Creating TP${i + 1}: ${Math.round(layer.pct * 100)}% @ $${priceStr} (Sz: ${layerSize})`);

            const payload = {
                coin: coin,
                is_buy: !isLong,
                sz: String(layerSize),
                limit_px: priceStr,
                order_type: { trigger: { triggerPx: priceStr, isMarket: true, tpsl: 'tp' as any } },
                reduce_only: true
            };

            await retry(async () => {
                const res = await sdk.exchange.placeOrder(payload);
                if (res.status === 'ok' && !res.response.data.statuses[0].error) {
                    console.log(`      ✅ Placed TP${i + 1}`);
                } else {
                    console.log(`      ❌ Failed TP${i + 1}:`, res.response?.data?.statuses?.[0]?.error || res);
                }
            }, `Place TP${i + 1}`);

            await new Promise(r => setTimeout(r, 1000));
        }
    }
}
run();
