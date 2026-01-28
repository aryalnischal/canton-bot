
// Binance Spot API (US Compatible)
const BINANCE_API_BASE = "https://api.binance.us";

export interface Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    fundingRate?: number;
}

export async function fetchHistoricalCandles(symbol: string, interval: string = '1h', limit: number = 1000): Promise<Candle[]> {
    let allCandles: Candle[] = [];
    let remaining = limit;
    let endTime: number | undefined = undefined;

    // Binance Spot Limit is 1000. We loop backward or forward.
    // Standard approach: Fetch latest 1000, then fetch previous 1000 using endTime.

    const BATCH_SIZE = 1000;

    try {
        while (remaining > 0) {
            const currentLimit = Math.min(remaining, BATCH_SIZE);
            const params = new URLSearchParams({
                symbol: symbol,
                interval: interval,
                limit: currentLimit.toString()
            });

            if (endTime) {
                params.append('endTime', endTime.toString());
            }

            const url = `${BINANCE_API_BASE}/api/v3/klines?${params}`;

            // console.log(`[DEBUG] Fetching batch... Need ${remaining} more. EndTime: ${endTime || 'Latest'}`);

            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            if (!res.ok) {
                console.error(`[API ERROR] ${res.status}`);
                break;
            }

            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;

            const batch: Candle[] = data.map((c: any) => ({
                openTime: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                closeTime: c[6]
            }));

            // Binance returns Oldest -> Newest.
            // If we are paging backwards (standard for "Last N candles"), we need to handle EndTime.
            // Actually, querying *without* endTime gets LATEST.
            // To get previous batch, we set endTime to the openTime of the oldest candle in this batch - 1ms.

            // Since we want a contiguous block, simplest is to unshift to array.
            // Batch: [oldest ... newest]
            // We want [oldest_of_all ... newest_of_all]

            allCandles = [...batch, ...allCandles]; // Prepend? No.
            // If we fetch without endTime, we get [Time-1000 ... Time-Now].
            // Next fetch needs endTime = (Time-1000) - 1.
            // So we are building the array backwards from Now.
            // Batch 1 (Latest): [T-1000, T-Now]
            // Batch 2 (Older): [T-2000, T-1001]
            // Combined: [Batch 2, Batch 1]

            // Correction: Spread logic.
            // allCandles starts empty.
            // Loop 1 (Latest): allCandles = batch.
            // Loop 2 (Older): allCandles = [...batch, ...allCandles].

            // Update endTime for next loop (Batch's oldest open time - 1)
            endTime = batch[0].openTime - 1;
            remaining -= batch.length;

            if (batch.length < currentLimit) break; // Exhausted history

            // Rate limit safety
            await new Promise(r => setTimeout(r, 200));
        }

        // Return chronological order (Oldest -> Newest)
        // Ensure strictly sorted just in case
        return allCandles.sort((a, b) => a.openTime - b.openTime);

    } catch (error) {
        console.error(`Failed to fetch history for ${symbol}`, error);
        return [];
    }
}

export async function fetchFundingHistory(symbol: string, limit: number = 100): Promise<{ time: number, rate: number }[]> {
    // Funding not available on Spot API
    return [];
}
