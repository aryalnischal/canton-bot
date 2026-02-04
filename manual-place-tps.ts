
import { Hyperliquid } from 'hyperliquid';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const wallet = new Wallet(process.env.HL_PRIVATE_KEY!);
const sdk = new Hyperliquid(wallet);

async function run() {
    console.log("🛠️  MANUAL TP PLACE (OP-PERP)...");
    const COIN = 'OP';
    try {
        const state = await sdk.info.perpetuals.getClearinghouseState(wallet.address);
        const pos = state.assetPositions.find((p: any) => p.position.coin === COIN);
        if (!pos) { console.log("No OP pos"); return; }

        const size = parseFloat(pos.position.szi);
        const entry = parseFloat(pos.position.entryPx);
        console.log(`Found OP: ${size} @ ${entry}`);

        // Logic from execution-engine
        const isBuy = size < 0; // Closing Short -> Buy
        const direction = isBuy ? 1 : -1; // Buy -> Price Up to close? No.
        // Wait: If Short (size < 0), we Close by BUYING.
        // TP for Short = Price LOWER.
        // direction: If Closing Short (Buy), Target is Entry * (1 - 0.05).
        // My code: `entry * (1 + (layer.gain * direction))`
        // isBuy=true -> direction=1 -> Entry * 1.05. (Price Up).
        // ERROR: If I am Short, my TP should be LOWER.
        // If I am Short, `isBuy` (Close Action) is True.

        // Correct Logic:
        // Long (Size > 0): Close=Sell. TP = Entry * 1.05 (Higher).
        // Short (Size < 0): Close=Buy. TP = Entry * 0.95 (Lower).

        // Check my `execution-engine.ts`:
        // const isBuy = action === 'BUY'; // This is ENTRY action.
        // Code: `const direction = isBuy ? 1 : -1;`
        // Open BUY (Long) -> Dir 1 -> TP 1.05. Correct.
        // Open SELL (Short) -> Dir -1 -> TP 0.95. Correct.

        // So why didn't it place?

        // Let's try placing manually.
        const tpPrice = entry * (size > 0 ? 1.05 : 0.95);
        console.log(`Placing TP @ $${tpPrice.toFixed(4)}...`);

        const res = await sdk.exchange.placeOrder({
            coin: COIN,
            is_buy: size < 0, // Close Size
            sz: Math.abs(size / 4),
            limit_px: tpPrice,
            order_type: {
                trigger: {
                    triggerPx: tpPrice,
                    isMarket: true,
                    tpsl: 'tp'
                }
            },
            reduce_only: true
        });
        console.log("Result:", JSON.stringify(res, null, 2));

    } catch (e) {
        console.error(e);
    }
}
run();
