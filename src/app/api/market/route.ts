
import { NextResponse } from 'next/server';
import { fetchBinanceData, fetchAllAssetsBatch, fetchHyperliquidCandleSnapshot } from '@/lib/api';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'BATCH', 'SINGLE', 'CANDLE_SNAPSHOT'
    const symbol = searchParams.get('symbol');
    const interval = searchParams.get('interval') || '1d';

    try {
        if (type === 'BATCH') {
            // FAST PATH: Return everything
            const data = await fetchAllAssetsBatch(interval);
            return NextResponse.json(data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=59'
                }
            });
        }

        if (type === 'CANDLE_SNAPSHOT') {
            if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

            const startTime = parseInt(searchParams.get('startTime') || '0');
            const endTime = parseInt(searchParams.get('endTime') || '0');
            const coin = symbol.replace('USDT', '');

            const data = await fetchHyperliquidCandleSnapshot(coin, interval, startTime, endTime);
            return NextResponse.json(data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59'
                }
            });
        }

        // SINGLE PATH (Legacy)
        if (!symbol) {
            return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
        }
        const data = await fetchBinanceData(symbol, interval);
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=59'
            }
        });
    } catch (error) {
        console.error("API Route Proxy Error:", error);
        return NextResponse.json({ error: 'Failed to fetch data', details: String(error) }, { status: 500 });
    }
}
