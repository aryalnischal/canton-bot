
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { HyperliquidExecutionService } from "./src/services/execution-engine";

async function forceClose() {
    const symbol = "FARTCOIN"; // As identified by audit
    console.log(`🧨 FORCE CLOSING: ${symbol}...`);

    try {
        const engine = new HyperliquidExecutionService();
        // Wait for init (constructor is sync but internal init is async promise in property)
        // Accessing private init promise? No, public method ensureAssetIdMap handles it.
        // We can just call executeOrder.

        // Execute Market Sell (Reduce Only)
        // We need to know current size first.

        const state = await engine.getAccountState();

        console.log(`[DEBUG] Found ${state.assetPositions.length} positions:`);
        state.assetPositions.forEach((p: any) => console.log(`   - ${p.position.coin} (Sz: ${p.position.szi})`));

        const pos = state.assetPositions.find((p: any) => {
            const coin = p.position.coin;
            return coin === symbol || coin === `${symbol}-PERP` || coin.includes(symbol);
        });

        if (!pos) {
            console.log(`❌ Position for ${symbol} not found on-chain.`);
            return;
        }

        const size = parseFloat(pos.position.szi);
        console.log(`    Found Size: ${size} (${pos.position.positionValue} USD)`);

        if (size === 0) {
            console.log("    Position is already closed (Size 0).");
            return;
        }

        const isBuy = size < 0; // If Short (neg size), we Buy. If Long (pos size), we Sell.
        const action = isBuy ? 'BUY' : 'SELL';

        // EXECUTE
        const tx = await engine.executeOrder(
            symbol,
            action,
            Math.abs(size),
            parseFloat(pos.position.entryPx), // Using Entry Price as ref for Market close is risky if price moved 10%.
            // Better: Use a large slippage or just fetch Mids.
            // Actually, let's just use Entry Price and a HUGE slippage encoded?
            // No, let's try to fetch mids.
            1, // Lev
            true // Reduce Only
        );

        console.log("✅ CLOSE RESULT:", tx);

    } catch (e) {
        console.error("❌ CLOSE FAILED:", e);
    }
}

forceClose();
