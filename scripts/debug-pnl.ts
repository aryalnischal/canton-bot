
import { DydxExecutionService } from '../src/services/dydx-execution';

async function main() {
    console.log("Initializing Engine...");
    const engine = new DydxExecutionService();
    await engine.getAccountState();

    console.log("Fetching Account State...");
    const account = await engine.getAccountState();

    if (!account || !account.openPositions) {
        console.log("No open positions.");
        return;
    }

    const positions = account.openPositions;
    console.log("\n📊 CURRENT POSITIONS ANALYSIS:\n");

    for (const key in positions) {
        const p = positions[key];
        const symbol = p.market;
        const size = parseFloat(p.size);
        if (size === 0) continue;

        const uPnl = parseFloat(p.unrealizedPnl);
        const entry = parseFloat(p.entryPrice);
        const currentPrice = parseFloat(p.oraclePrice || p.entryPrice); // Use Oracle if available
        const notional = Math.abs(size * entry);

        // BOT LOGIC (Price Change %)
        const botPnLPct = (uPnl / notional) * 100;

        // ROE LOGIC (Return on Equity) -> What user sees on UI usually
        // Approx: BotPnL * Leverage
        // We can estimate leverage from size / (equity allocated). 
        // But simpler: price change * leverage.
        // Let's just print raw values.

        console.log(`🔹 ${symbol} (${size > 0 ? 'LONG' : 'SHORT'})`);
        console.log(`   Entry: $${entry.toFixed(4)} | P: $${currentPrice.toFixed(4)}`);
        console.log(`   Size: ${size} | Notional: $${notional.toFixed(2)}`);
        console.log(`   uPnL: $${uPnl.toFixed(2)}`);
        console.log(`   --------------------------------`);
        console.log(`   🤖 BOT SEES (Price Move): ${botPnLPct.toFixed(2)}%`);
        console.log(`      (Trigger TP1 @ 2.0%, TP2 @ 4.0%)`);
        console.log(`   --------------------------------`);

        // Heuristic for ROE
        // If Lev is 10x, ROE should be ~10 * BotPnL
        console.log(`   👁️ ROE Estimates:`);
        console.log(`      @ 3x: ${(botPnLPct * 3).toFixed(2)}%`);
        console.log(`      @ 5x: ${(botPnLPct * 5).toFixed(2)}%`);
        console.log(`      @ 10x: ${(botPnLPct * 10).toFixed(2)}%`);
        console.log("\n");
    }
}

main();
