import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';

async function main() {
    const networkConfig = Network.mainnet();
    const client = new IndexerClient(networkConfig.indexerConfig);

    console.log("Fetching Markets...");
    const response = await client.markets.getPerpetualMarkets();
    const markets = response.markets;
    const keys = Object.keys(markets);

    console.log(`Total Markets: ${keys.length}`);

    // Search for CC
    const cc = keys.find(k => k.includes('CC') || k.includes('CANTON'));
    if (cc) {
        console.log(`FOUND CC: ${cc}`);
        console.log(markets[cc]);
    } else {
        console.log("❌ 'CC' NOT FOUND in market list.");
    }

    // List all keys to be sure
    console.log("All Markets:", keys.join(', '));
}

main();
