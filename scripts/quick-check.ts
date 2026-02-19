import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { DydxExecutionService } from '../src/services/dydx-execution';

(async () => {
    const engine = new DydxExecutionService();
    const state = await engine.getAccountState();
    if (!state) { console.log('❌ No state returned'); process.exit(1); }
    console.log('💰 Equity:', state.equity);
    console.log('💰 Free Collateral:', state.freeCollateral);
    const positions = state.openPositions || {};
    const keys = Object.keys(positions);
    if (keys.length === 0) {
        console.log('✅ No active positions');
    } else {
        for (const k of keys) {
            const p = positions[k];
            const size = parseFloat(p.size);
            console.log(`\n📊 ${k}:`);
            console.log(`   Size: ${p.size} (${size > 0 ? 'LONG' : 'SHORT'})`);
            console.log(`   Entry: $${p.entryPrice}`);
            console.log(`   uPnL: $${p.unrealizedPnl}`);
        }
    }
    process.exit(0);
})();
