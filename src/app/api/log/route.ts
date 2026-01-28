import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Log from '@/models/Log';

export async function POST(req: NextRequest) {
    try {
        await dbConnect();

        const body = await req.json();
        const { level, message, ...meta } = body;

        if (!message) {
            return NextResponse.json({ success: false, error: 'Missing message' }, { status: 400 });
        }

        // Save to MongoDB
        const newLog = await Log.create({
            level: level || 'info',
            message: message,
            meta: meta,
            source: 'CLIENT',
            timestamp: Date.now()
        });

        // Optional: Also log to server console for realtime connection monitoring
        // console.log(`[CLIENT_LOG] ${message}`);

        return NextResponse.json({ success: true, id: newLog._id });
    } catch (e: any) {
        console.error("[API_LOG_ERROR]", e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
