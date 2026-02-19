
import { DydxExecutionService } from '../src/services/dydx-execution';

async function main() {
    console.log("🚨 EMERGENCY: CLOSING DASH-USD...");
    const engine = new DydxExecutionService();
    await engine.getAccountState();

    const account = await engine.getAccountState();
    if (!account || !account.openPositions) return;

    const p = account.openPositions['DASH-USD'];
    if (p) {
        const size = parseFloat(p.size);
        const side = size > 0 ? 'SELL' : 'BUY';
        const price = parseFloat(p.oraclePrice || p.entryPrice);

        console.log(`📉 Closing ${p.size} DASH @ $${price}...`);

        await engine.executeOrder(
            'DASH-USD',
            side,
            Math.abs(size * price),
            price,
            1,
            true // ReduceOnly
        );
        console.log("✅ DASH CLOSED.");
    } else {
        console.log("✅ DASH not found (Already closed?)");
    }
}

main();
