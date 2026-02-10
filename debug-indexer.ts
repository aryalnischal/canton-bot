
import { IndexerClient, Network } from '@dydxprotocol/v4-client-js';

const indexer = new IndexerClient(Network.mainnet().indexerConfig);

console.log("---- MARKET MODULE ----");
try {
    const markets = (indexer as any).markets; // This is an OBJECT of functions usually, not a class instance?
    // Wait, debug output showed Proto was [getPerpetualMarkets...]. This implies `markets` IS a class instance.

    console.log("getPerpetualMarketCandles ARITY:", markets.getPerpetualMarketCandles.length);
    console.log("getPerpetualMarketCandles SOURCE:", markets.getPerpetualMarketCandles.toString());
} catch (e) { console.log("Error:", e); }

console.log("---- UTILITY MODULE ----");
try {
    const util = (indexer as any).utility;
    console.log("Proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(util)));
} catch (e) { }

console.log("---- CANDLES MODULE? ----");
try {
    console.log("Direct Proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(indexer)));
} catch (e) { }
