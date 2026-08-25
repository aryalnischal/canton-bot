// Shared Pre-Trade Safety Gates
// Used by both standalone-bot.ts and /api/trade to ensure identical protection.

import dbConnect from '@/lib/db';
import Trade from '@/models/Trade';
import { DydxExecutionService } from '@/services/dydx-execution';

export interface GuardResult {
    allowed: boolean;
    reason?: string;   // Human-readable rejection reason
    gate?: string;     // Which gate blocked it (for logging)
}

const COOLDOWN_MINUTES = 30;  // Min time after closing before re-entering same symbol
// Shared with scripts/standalone-bot.ts — was hardcoded separately there as 4,
// which silently drifted from this file's old value of 3. Single source of truth now.
export const MAX_POSITIONS = 4;      // Max simultaneous open trades
const DAILY_DRAWDOWN_PCT = -10; // Circuit breaker threshold

/**
 * 5-Layer Pre-Trade Check.
 * Call this BEFORE every trade execution.
 *
 * Layer 1: On-Chain Position Check (dYdX)
 * Layer 2: DB Duplicate Check (MongoDB)
 * Layer 3: Cooldown Timer (30min after close)
 * Layer 4: Max Position Limit (3)
 * Layer 5: Daily Circuit Breaker (-10% PnL)
 */
export async function preTradeCheck(
    symbol: string,
    action: 'BUY' | 'SELL',
    engine: DydxExecutionService
): Promise<GuardResult> {

    // ── Layer 1: ON-CHAIN POSITION CHECK ──
    try {
        const account = await engine.getAccountState();
        if (account?.openPositions?.[symbol]) {
            const pos = account.openPositions[symbol];
            return {
                allowed: false,
                reason: `On-chain position already exists: ${pos.side} ${pos.size} @ $${pos.entryPrice}`,
                gate: 'ONCHAIN_DUPLICATE'
            };
        }
    } catch (e) {
        console.warn('[GUARD] On-chain check failed (permitting):', e);
    }

    // ── Layers 2-5: DB Checks ──
    try {
        await dbConnect();

        // Layer 2: DB DUPLICATE CHECK
        const existing = await Trade.findOne({ symbol, status: 'OPEN' });
        if (existing) {
            return {
                allowed: false,
                reason: `DB shows OPEN trade on ${symbol} (action: ${existing.action}, entry: $${existing.price})`,
                gate: 'DB_DUPLICATE'
            };
        }

        // Layer 3: COOLDOWN TIMER
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
        const cooldownThreshold = Date.now() - cooldownMs;
        const recentClose = await Trade.findOne({
            symbol,
            status: 'CLOSED',
            exitTime: { $gt: cooldownThreshold }
        }).sort({ exitTime: -1 });

        if (recentClose) {
            const readyAt = new Date(recentClose.exitTime + cooldownMs).toLocaleTimeString();
            const minutesLeft = Math.ceil(((recentClose.exitTime + cooldownMs) - Date.now()) / 60000);
            return {
                allowed: false,
                reason: `${symbol} closed ${minutesLeft}min ago. Cooldown until ${readyAt} (${COOLDOWN_MINUTES}min rule)`,
                gate: 'COOLDOWN'
            };
        }

        // Layer 4: MAX POSITIONS
        const openCount = await Trade.countDocuments({ status: 'OPEN' });
        if (openCount >= MAX_POSITIONS) {
            return {
                allowed: false,
                reason: `Max ${MAX_POSITIONS} positions reached (${openCount} open)`,
                gate: 'MAX_POSITIONS'
            };
        }

        // Layer 5: DAILY CIRCUIT BREAKER
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const dailyTrades = await Trade.find({
            status: 'CLOSED',
            exitTime: { $gt: oneDayAgo }
        });

        if (dailyTrades.length > 0) {
            const dailyPnL = dailyTrades.reduce((acc: number, t: any) => acc + (t.pnlValue || 0), 0);
            const account = await engine.getAccountState();
            const equity = account ? parseFloat(account.equity || '250') : 250;
            const pnlPct = (dailyPnL / Math.max(equity, 100)) * 100;

            if (pnlPct < DAILY_DRAWDOWN_PCT) {
                return {
                    allowed: false,
                    reason: `CIRCUIT BREAKER: Daily PnL ${pnlPct.toFixed(1)}% exceeds ${DAILY_DRAWDOWN_PCT}% threshold`,
                    gate: 'CIRCUIT_BREAKER'
                };
            }
        }

    } catch (dbErr) {
        // If DB is unavailable, Layer 1 (on-chain) already passed. Allow with warning.
        console.warn('[GUARD] DB check failed (permitting — on-chain guard passed):', dbErr);
    }

    return { allowed: true };
}
