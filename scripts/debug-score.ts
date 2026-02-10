
import { ScannerService } from '../src/services/scanner';
import { generateV5Consensus } from '../src/lib/v5/analysis-v5';
import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    console.log("Analyzing ETH-USD Deep Dive...");

    // 1. Fetch Data Manually to debug
    const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
    const client = new IndexerClient(networkConfig.indexerConfig);

    const symbol = "ETH-USD";

    try {
        // Candles
        const candlesRes = await client.markets.getPerpetualMarketCandles(symbol, '15MINS', undefined, undefined, 50);
        const candles = candlesRes.candles.map((c: any) => ({
            c: parseFloat(c.close),
            v: parseFloat(c.baseTokenVolume),
            h: parseFloat(c.high),
            l: parseFloat(c.low),
            o: parseFloat(c.open)
        })).reverse();

        // Market Data
        const marketsRes = await client.markets.getPerpetualMarkets();
        const market = marketsRes.markets[symbol];
        const price = parseFloat(market.oraclePrice || market.price);

        // Mock Metrics
        const metrics = [{
            symbol,
            price,
            priceChange24h: 0,
            volumeChange24h: 0,
            high24h: price * 1.05,
            low24h: price * 0.95,
            fundingRate: parseFloat(market.nextFundingRate),
            open: price
        }];

        // Run Consensus
        const consensus = generateV5Consensus(
            metrics as any,
            candles,
            null, // Orderbook
            { longShortRatio: 1, topTraderLsr: 1, longLiq: 0, shortLiq: 0 } as any, // Coinglass
            { isBullish: false, isBearish: false, netFlow: 0, whaleScore: 0.5, tvlChange: 0, btcInflow: 0, usdcInflow: 0 }, // OnChain
            0, // MaxPain
            parseFloat(market.nextFundingRate)
        );

        console.log("\n--- DEEP DIVE RESULTS ---");
        console.log(`Action: ${consensus.action}`);
        console.log(`Final Score: ${consensus.score.toFixed(3)}`);
        console.log("-------------------------");
        console.log("VOTES:");
        console.log(`  V2 (Trend):     ${consensus.votes.v2}`);
        console.log(`  V3 (Liquidity): ${consensus.votes.v3}`);
        console.log(`  V4 (Neural):    ${consensus.votes.v4}`);
        console.log(`  On-Chain:       ${consensus.votes.onChain}`);
        console.log("-------------------------");
        console.log("REASONS:");
        consensus.reasons.forEach(r => console.log(`  - ${r}`));

    } catch (e) {
        console.error(e);
    }
}

main();
