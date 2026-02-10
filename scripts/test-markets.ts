
import { IndexerClient, Network } from '@dydxprotocol/v4-client-js';

async function main() {
    try {
        console.log("Initializing Indexer Client (Mainnet)...");
        const config = Network.mainnet().indexerConfig;
        const client = new IndexerClient(config);

        console.log("Fetching Markets...");
        const start = Date.now();
        const markets = await client.markets.getPerpetualMarkets();
        const end = Date.now();

        console.log(`Fetched in ${end - start}ms`);
        const keys = Object.keys(markets);
        console.log(`Found ${keys.length} markets.`);
        console.log("Sample:", keys.slice(0, 5));
    } catch (e) {
        console.error("Error fetching markets:", e);
    }
}

main();
