/**
 * dYdX Rate Limiter — prevents 429 errors by spacing API requests.
 * 
 * All dYdX IndexerClient calls should go through `rateLimitedCall(fn)`
 * to enforce a minimum gap between consecutive requests.
 * 
 * Uses a simple queue with sequential execution.
 */

const MIN_GAP_MS = 150; // Minimum 150ms between dYdX API calls (~6 req/s)
let lastCallTime = 0;
let queue: Array<{ fn: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];
let processing = false;

async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
        const item = queue.shift()!;
        const now = Date.now();
        const elapsed = now - lastCallTime;

        if (elapsed < MIN_GAP_MS) {
            await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
        }

        try {
            lastCallTime = Date.now();
            const result = await item.fn();
            item.resolve(result);
        } catch (err) {
            item.reject(err);
        }
    }

    processing = false;
}

/**
 * Execute a dYdX API call through the rate limiter.
 * Ensures at least MIN_GAP_MS between consecutive calls.
 * 
 * Usage:
 *   const candles = await rateLimitedCall(() => indexer.markets.getCandles(...));
 */
export function rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
    });
}

/**
 * Get current queue depth (for debugging/logging)
 */
export function getQueueDepth(): number {
    return queue.length;
}
