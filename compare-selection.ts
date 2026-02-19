
import { IndexerClient, Network } from '@dydxprotocol/v4-client-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    try {
        console.log("Fetching markets for comparison...");
        const network = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
        const client = new IndexerClient(network.indexerConfig);
        const response = await client.markets.getPerpetualMarkets();
        const markets = response.markets;

        const marketKeys = Object.keys(markets).filter(k =>
            k.endsWith('USD') && !k.includes(',') && !k.includes('0x') && !k.includes('prediction')
        );

        // Sort by Volume
        const sortedByVol = [...marketKeys].sort((a, b) => {
            const volA = parseFloat(markets[a].volume24H || "0");
            const volB = parseFloat(markets[b].volume24H || "0");
            return volB - volA;
        });

        const top10 = sortedByVol.slice(0, 10);
        const top15 = sortedByVol.slice(0, 15);
        const extra5 = sortedByVol.slice(10, 15);

        console.log("\n--- Top 10 Volume (Current Strategy) ---");
        console.log(top10.join(', '));

        console.log("\n--- Next 5 (If we expand to Top 15) ---");
        extra5.forEach(m => {
            const vol = parseFloat(markets[m].volume24H || "0").toLocaleString();
            console.log(`${m} (Vol: $${vol})`);
        });

        // Check DASH rank
        const dashIndex = sortedByVol.findIndex(m => m === 'DASH-USD');
        if (dashIndex !== -1) {
            console.log(`\n[CHECK] DASH-USD is currently rank #${dashIndex + 1} by Volume.`);
        } else {
            console.log("\n[CHECK] DASH-USD not found in active markets.");
        }

    } catch (e) {
        console.error(e);
    }
}

main();
