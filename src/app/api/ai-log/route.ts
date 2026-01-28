
import { NextResponse } from 'next/server';
import { AIDataCollector } from '@/lib/ai-data-collector';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { type, trade, features, id, result } = body;

        // 1. Log Trade Entry (Features)
        if (type === 'log') {
            AIDataCollector.logTradeAttempt(trade, features);
            return NextResponse.json({ success: true, message: "Logged Features" });
        }

        // 2. Log Trade Exit (Label)
        if (type === 'label') {
            AIDataCollector.labelTrade(id, result);
            return NextResponse.json({ success: true, message: "Labelled Outcome" });
        }

        return NextResponse.json({ success: false, error: "Invalid Type" }, { status: 400 });

    } catch (e: any) {
        console.error("AI Log Error:", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
