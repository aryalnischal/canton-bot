
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

import { DydxExecutionService } from '../src/services/dydx-execution';

async function main() {
    const engine = new DydxExecutionService();

    // Wait for init to complete
    await new Promise(r => setTimeout(r, 3000));

    const state = await engine.getAccountState();
    if (!state) { console.log('No account state'); return; }

    const positions = state.openPositions || {};
    const keys = Object.keys(positions).filter(k => parseFloat(positions[k].size) !== 0);

    if (keys.length === 0) { console.log('No open positions.'); return; }

    console.log(`Found ${keys.length} open positions. Closing all...`);

    for (const symbol of keys) {
        const pos = positions[symbol];
        const size = parseFloat(pos.size);
        const price = parseFloat(pos.oraclePrice || pos.entryPrice);
        const tokenSize = Math.abs(size);
        const sizeUsd = tokenSize * price;
        const closeSide = size > 0 ? 'SELL' : 'BUY';

        console.log(`Closing ${symbol}: ${closeSide} ${tokenSize} tokens ($${sizeUsd.toFixed(2)})`);

        try {
            const result = await engine.executeOrder(symbol, closeSide, sizeUsd, price, 1, true);
            console.log(`  → ${result.success ? '✅ Closed' : '❌ Failed: ' + result.error}`);
        } catch (e) {
            console.error(`  → ❌ Error:`, e);
        }

        await new Promise(r => setTimeout(r, 1500));
    }

    console.log('\nVerifying...');
    await new Promise(r => setTimeout(r, 2000));
    const finalState = await engine.getAccountState();
    const remaining = Object.keys(finalState?.openPositions || {}).filter(
        k => parseFloat(finalState!.openPositions[k].size) !== 0
    );
    console.log(`Remaining: ${remaining.length}`);
    if (remaining.length === 0) console.log('✅ All clear — ready for fresh start!');
    else console.log('⚠️ Still open:', remaining.join(', '));
}

main().catch(console.error);
