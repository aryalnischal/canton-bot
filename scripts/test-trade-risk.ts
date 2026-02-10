
import { DydxExecutionService } from '../src/services/dydx-execution';
import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    try {
        console.log("Step 1: Init Service");
        const engine = new DydxExecutionService();

        // Wait up to 10s for Ready
        let ready = false;
        for (let i = 0; i < 10; i++) {
            if ((engine as any).isReady) { ready = true; break; }
            await new Promise(r => setTimeout(r, 1000));
            console.log("...waiting for engine...");
        }

        if (!ready) { console.error("Engine Not Ready"); return; }

        console.log("Step 2: Fetching Oracle Price...");
        const client = new IndexerClient(Network.mainnet().indexerConfig);
        const response = await client.markets.getPerpetualMarkets();
        const market = response.markets["ETH-USD"];

        console.log("Market Info:", market ? "Found" : "Not Found");
        const price = parseFloat(market.oraclePrice || market.price || "0");
        console.log(`Oracle Price: $${price}`);

        if (price <= 0) throw new Error("Price is 0 or Invalid");

        // TP: +4%, SL: -2%
        const tp = parseFloat((price * 1.04).toFixed(4));
        const sl = parseFloat((price * 0.98).toFixed(4));

        console.log(`Step 3: Execute Order ($10)... TP: ${tp}, SL: ${sl}`);
        const result = await engine.executeOrder(
            "ETH-USD",
            'BUY',
            10,
            price,
            1,
            false,
            { tp, sl }
        );

        console.log("FINAL RESULT:", result);

    } catch (e) {
        console.error("Test Failed:", e);
    }
}

main();
