
import { IndexerClient, Network } from '@dydxprotocol/v4-client-js';

async function main() {
    try {
        const client = new IndexerClient(Network.mainnet().indexerConfig);
        console.log("Fetching Markets...");
        const response = await client.markets.getPerpetualMarkets();
        const markets = response.markets;

        const symbol = "ETH-USD";
        const market = markets[symbol];

        if (market) {
            console.log(`[${symbol} Object]:`);
            console.log(JSON.stringify(market, null, 2));
        } else {
            console.log("ETH-USD not found.");
        }
    } catch (e) {
        console.error(e);
    }
}

main();
