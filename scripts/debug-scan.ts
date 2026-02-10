
import { ScannerService } from '../src/services/scanner';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("Initializing Scanner Service...");
    const scanner = new ScannerService();

    console.log("Running Scan (Limit 5)...");
    try {
        const start = Date.now();
        const { markets, signals } = await scanner.scanMarkets(5);
        const duration = Date.now() - start;

        console.log(`\nScan Complete in ${duration}ms`);
        console.log(`Markets Found: ${markets.length}`);
        console.log(`Signals Found: ${signals.length}`);

        console.log("\n--- SIGNALS ---");
        signals.forEach(s => {
            console.log(`${s.symbol}: ${s.action} (Score: ${s.score})`);
            console.log(`   Reasons: ${s.reasons.join(', ')}`);
        });

    } catch (e) {
        console.error("Scan Failed:", e);
    }
}

main();
