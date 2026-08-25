import Trade from '@/models/Trade';
import Analysis from '@/models/Analysis';
import dbConnect from '@/lib/db';

export class TradeAnalyzer {

    /**
     * Performs an autopsy on a closed trade.
     * @param tradeId - The internal MongoDB _id or the 'id' string of the trade
     */
    static async performAutopsy(tradeId: string) {
        await dbConnect();

        // Find Trade
        const trade = await Trade.findOne({ $or: [{ id: tradeId }, { _id: tradeId }, { txHash: tradeId }] });

        if (!trade || trade.status !== 'CLOSED') {
            // console.warn(`[ANALYZER] Trade not found or not closed: ${tradeId}`);
            return null;
        }

        console.log(`[ANALYZER] Performing Autopsy on ${trade.symbol} (${trade.result === 'WIN' ? 'WIN' : 'LOSS'})`);

        // 1. Determine Result
        const pnl = trade.pnlPercent || 0;
        const result = pnl >= 0 ? 'WIN' : 'LOSS';

        // 2. Root Cause Analysis (Heuristic)
        let rootCause = "Market Variance";
        let prevention = "None";
        let qualityScore = 50;

        if (result === 'LOSS') {
            qualityScore = 20;

            // Check Exit Reason
            if (trade.exitReason?.includes("LIQUIDATION")) {
                rootCause = "Over-Leverage / Liquidation Risk";
                prevention = "Reduce Leverage to 3x";
            } else if (trade.exitReason?.includes("STOP_LOSS")) {
                rootCause = "Standard Stop Loss";

                // Deep Dive: Was it a "Fakeout"?
                // If we had candle data, we could check if price reversed immediately after SL.
                // Without candle data, we assume bad entry.
                prevention = "Wait for Confirmation Candle";
            } else if (trade.exitReason?.includes("TREND FLIP")) {
                rootCause = "Trend Reversal";
                prevention = "None (System worked as intended)";
                qualityScore = 40; // Valid attempt, market changed
            }

            // AI Context Check
            if (trade.signalSnapshot) {
                const snapshot = trade.signalSnapshot;
                if (snapshot.confidence && snapshot.confidence < 50) {
                    rootCause = "Low Confidence Entry";
                    prevention = "Raise Minimum Confidence Threshold";
                }
            }
        } else {
            // WIN
            qualityScore = 80;
            rootCause = "Valid Strategy";
            if (pnl > 5) qualityScore = 95; // Home Run
        }

        // 3. Save Analysis
        const analysis = await Analysis.create({
            tradeId: trade.id, // Link using ID String
            symbol: trade.symbol,
            result,
            pnlPercent: pnl,
            rootCause,
            prevention,
            qualityScore,
            timestamp: Date.now()
        });

        console.log(`[ANALYZER] Autopsy Complete: ${rootCause} -> ${prevention}`);
        return analysis;
    }

    /**
     * Checks if an asset should be blacklisted based on recent performance.
     * Reads Trade directly — Analysis rows are only created by the (unused)
     * manual /api/analysis/autopsy endpoint, so the Analysis collection is
     * always empty in practice and this gate was previously a permanent no-op.
     */
    static async checkBlacklist(symbol: string): Promise<boolean> {
        await dbConnect();

        // Look back 24 hours
        const yesterday = Date.now() - 24 * 60 * 60 * 1000;

        const recentLosses = await Trade.countDocuments({
            symbol,
            status: 'CLOSED',
            pnlPercent: { $lt: 0 },
            exitTime: { $gt: yesterday }
        });

        if (recentLosses >= 3) {
            console.warn(`[BLACKLIST] ${symbol} has ${recentLosses} recent losses. Recommendation: AVOID.`);
            return true;
        }

        return false;
    }
}
