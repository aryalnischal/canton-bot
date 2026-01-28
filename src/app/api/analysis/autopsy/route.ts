import { NextResponse } from 'next/server';
import { TradeAnalyzer } from '@/services/trade-analyzer';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { tradeId } = body;

        if (!tradeId) {
            return NextResponse.json({ success: false, error: "Missing tradeId" }, { status: 400 });
        }

        const analysis = await TradeAnalyzer.performAutopsy(tradeId);

        if (!analysis) {
            return NextResponse.json({ success: false, error: "Analysis failed (Trade not found or not closed)" }, { status: 404 });
        }

        return NextResponse.json({ success: true, analysis });

    } catch (e: any) {
        console.error("[API] Autopsy Error", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
