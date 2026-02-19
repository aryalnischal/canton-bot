
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

import { DydxExecutionService } from '../src/services/dydx-execution';

async function main() {
    const engine = new DydxExecutionService();
    await new Promise(r => setTimeout(r, 3000));

    const state = await engine.getAccountState();
    if (!state) { console.log('No account state'); return; }

    const bonk = state.openPositions?.['BONK-USD'];
    if (!bonk || parseFloat(bonk.size) === 0) {
        console.log('BONK already closed!');
        return;
    }

    const sz = Math.abs(parseFloat(bonk.size));
    const pr = parseFloat(bonk.oraclePrice || bonk.entryPrice);
    // Send 3x size to ensure full close with rounding
    const usd = sz * pr * 3;
    console.log('BONK size:', sz, 'price:', pr, 'sending USD:', usd);

    const result = await engine.executeOrder('BONK-USD', 'BUY', usd, pr, 1, true);
    console.log(result.success ? 'BONK CLOSED!' : 'Failed: ' + result.error);
}

main().catch(console.error);
