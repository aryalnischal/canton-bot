// In-memory activity log — zero DB overhead
// Ring buffer of the last 50 entries, survives across API calls but resets on restart

export interface ActivityEntry {
    timestamp: number;
    type: 'SCAN' | 'TRADE' | 'GUARD' | 'INFO';
    message: string;
    details?: Record<string, any>;
}

const MAX_ENTRIES = 50;
const entries: ActivityEntry[] = [];

export function logActivity(type: ActivityEntry['type'], message: string, details?: Record<string, any>) {
    entries.push({ timestamp: Date.now(), type, message, details });
    if (entries.length > MAX_ENTRIES) {
        entries.shift(); // Remove oldest
    }
}

export function getRecentActivity(minutes: number = 10): ActivityEntry[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return entries.filter(e => e.timestamp >= cutoff).reverse(); // Newest first
}

export function getAllActivity(): ActivityEntry[] {
    return [...entries].reverse();
}
