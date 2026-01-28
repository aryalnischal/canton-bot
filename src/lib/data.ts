import { ExchangeMetric } from "./types";

export const MOCK_DATA: ExchangeMetric[] = [
    {
        rank: 1,
        exchange: "Binance",
        pair: "CC/USDT",
        price: 0.12963, // User's Price
        priceChange24h: -2.08, // User's Trend
        fundingRate: -0.0026, // User's Funding (Negative)
        volume24h: 130250000,
        volumeChange24h: 11.32,
        openInterest: 92010000,
        openInterestChange24h: -5.70,
        longShortRatio: 0.92, // Bearish sentiment
        longLiq24h: 247000, // Longs getting wrecked
        shortLiq24h: 50000,
        high24h: 0.13500,
        low24h: 0.12000
    },
    // Keep others but less relevant
    {
        rank: 2,
        exchange: "Hyperliquid",
        pair: "CC/USD",
        price: 0.12950,
        priceChange24h: -2.15,
        fundingRate: -0.0025,
        volume24h: 45000000,
        volumeChange24h: 5.2,
        openInterest: 35000000,
        openInterestChange24h: 0,
        longShortRatio: 2.1,
        longLiq24h: 0,
        shortLiq24h: 0,
        high24h: 1.05,
        low24h: 0.95
    },
];
