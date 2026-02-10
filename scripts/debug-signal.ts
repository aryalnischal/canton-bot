
import { Network, IndexerClient } from '@dydxprotocol/v4-client-js';
import { generateV5Consensus } from '../src/lib/v5/analysis-v5';
import { calculateMaxPain } from '../src/services/deribit-api';

// Mocks for Context
const MOCK_ON_CHAIN = { isBullish: false, isBearish: false, netFlow: 0, whaleScore: 0.5, tvlChange: 0, btcInflow: 0, usdcInflow: 0 };
const MOCK_COINGLASS = { longShortRatio: 1.0, topTraderLsr: 1.0, longLiq: 0, shortLiq: 0, oiChangePercent: 0 };

async function main() {
    const symbol = process.argv[2] || 'ETH-USD';
    console.log(`Debugging Signal for ${symbol}...`);

    const networkConfig = process.env.DYDX_NETWORK === 'mainnet' ? Network.mainnet() : Network.testnet();
    const indexer = new IndexerClient(networkConfig.indexerConfig);

    // 1. Fetch Market
    const marketsRes = await indexer.markets.getPerpetualMarkets();
    const market = marketsRes.markets[symbol];
    if (!market) {
        console.error("Market not found");
        return;
    }

    // 2. Fetch Candles
    const candlesRes = await (indexer as any).markets.getPerpetualMarketCandles(symbol, '15MINS', undefined, undefined, 50);
    const candles = candlesRes.candles.map((c: any) => ({
        t: new Date(c.startedAt).getTime(),
        o: parseFloat(c.open),
        h: parseFloat(c.high),
        l: parseFloat(c.low),
        c: parseFloat(c.close),
        v: parseFloat(c.baseTokenVolume)
    })).reverse();

    console.log(`fetched ${candles.length} candles. Last Price: ${candles[candles.length - 1].c}`);

    // 3. Metrics
    const currentPrice = parseFloat(market.oraclePrice);
    const metrics = [{
        symbol: symbol,
        price: currentPrice,
        priceChange24h: 0,
        volumeChange24h: 0,
        high24h: 0,
        low24h: 0,
        fundingRate: parseFloat(market.nextFundingRate),
        open: 0
    }];

    // 4. Max Pain
    const maxPain = await calculateMaxPain(symbol).catch(() => 0);
    console.log(`Max Pain: ${maxPain}`);

    // 5. Generate Consensus
    const consensus = generateV5Consensus(
        metrics as any,
        candles,
        null, // No Orderbook for simplicity, or we can fetch it
        MOCK_COINGLASS,
        MOCK_ON_CHAIN, // Mock OnChain for now implies Neutral
        maxPain,
        parseFloat(market.nextFundingRate)
    );

    console.log("\n--- V5 CONSENSUS DEBUG ---");
    console.log(`Action: ${consensus.action}`);
    console.log(`Score:  ${consensus.score.toFixed(3)}`);
    console.log(`Conf:   ${consensus.confidence}%`);
    console.log("Votes:");
    console.log(JSON.stringify(consensus.votes, null, 2));
    console.log("Reasons:", consensus.reasons);
}

main();
