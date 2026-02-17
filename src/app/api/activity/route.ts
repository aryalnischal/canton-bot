import { NextResponse } from 'next/server';
import { getRecentActivity } from '@/lib/activity-store';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const minutes = parseInt(searchParams.get('minutes') || '10');

    const activity = getRecentActivity(Math.min(minutes, 60)); // Cap at 60min

    return NextResponse.json({
        success: true,
        count: activity.length,
        activity
    });
}
