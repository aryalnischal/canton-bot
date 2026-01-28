export interface ExchangeMetric {
    rank: number;
    exchange: string;
    pair: string;
    price: number;
    priceChange24h: number; // percentage
    fundingRate: number; // percentage
    volume24h: number;
    volumeChange24h: number; // percentage
    openInterest: number;
    openInterestChange24h: number; // percentage
    longShortRatio: number;
    longLiq24h: number;
    shortLiq24h: number;
    high24h: number;
    low24h: number;
    activeInterval?: string;
    error?: string;
    marketType?: 'SPOT' | 'FUTURES';
    symbol?: string; // Compatibility alias for pair
    open?: number;   // Calculated Open Price
    timestamp?: number; // Last Socket Update Time
}
