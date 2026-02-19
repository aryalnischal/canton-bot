
import { DydxExecutionService } from '../src/services/dydx-execution';
import { ScannerService } from '../src/services/scanner';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
    console.log("🔍 DIAGNOSING BOT STATE...");

    // 1. Check Account
    console.log("\n[1] Checking Account State...");
    const engine = new DydxExecutionService();
    const account = await engine.getAccountState();

    if (account) {
        const positions = account.openPositions;
        const keys = Object.keys(positions);
        console.log(`   > Open Positions: ${keys.length}`);
        if (keys.length > 0) {
            keys.forEach(k => {
                const p = positions[k];
                console.log(`     - ${k}: ${p.size} (PnL: ${p.unrealizedPnl})`);
            });
        } else {
            console.log("   > No Open Positions (Clean Slate).");
        }

        console.log(`   > Equity: $${account.equity}`);
        console.log(`   > Free Collateral: $${account.freeCollateral}`);
    } else {
        console.error("   > Failed to fetch account state.");
    }

    // 2. Check Scanner
    console.log("\n[2] Running Market Scan...");
    const scanner = new ScannerService();
    // scanMarkets returns { markets, signals }
    const result = await scanner.scanMarkets();
    const signals = result.signals;

    console.log(`   > Scan Complete. Found ${signals.length} signals.`);

    if (signals.length > 0) {
        console.log("   > Top 5 Signals:");
        signals.slice(0, 5).forEach(s => {
            console.log(`     - ${s.market}: Score ${s.score.toFixed(2)} (Conf: ${(s.confidence * 100).toFixed(0)}%) Action: ${s.action}`);
            if (s.reasons) console.log(`       Reasons: ${s.reasons.join(', ')}`);
        });
    } else {
        console.log("   > No signals found. Market might be boring or thresholds too high.");
    }
}

main();
