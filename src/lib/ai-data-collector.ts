
import fs from 'fs';
import path from 'path';

// AI Training Data Structure
export interface TradeFeatureLog {
    id: string;
    timestamp: number;
    symbol: string;
    action: 'BUY' | 'SELL';

    // Features (Must be numeric/boolean for RF)
    rsi: number;
    trend_slope: number; // Slope of SMA50 (or current - sma50)
    volatility: number; // Bollinger Band Width or ATR
    funding_rate: number;
    volume_surge: number; // 1 = Yes, 0 = No
    distance_from_sma: number; // (Price - SMA) / SMA

    // Target (Added later)
    result_pnl_percent?: number;
    target_class?: 0 | 1; // 0 = Loss, 1 = Win
}

const LOG_FILE = path.join(process.cwd(), 'ai_trade_history.json');

export class AIDataCollector {

    // Log a new attempt (Features Only)
    static logTradeAttempt(trade: any, features: {
        rsi: number,
        trend_slope?: number,
        volatility?: number,
        funding_rate?: number,
        volume_surge?: boolean,
        distance_from_sma?: number
    }) {
        try {
            const history = this.getHistory();

            const logEntry: TradeFeatureLog = {
                id: trade.id,
                timestamp: Date.now(),
                symbol: trade.symbol,
                action: trade.action,
                rsi: features.rsi || 50,
                trend_slope: features.trend_slope || 0,
                volatility: features.volatility || 0,
                funding_rate: features.funding_rate || 0,
                volume_surge: features.volume_surge ? 1 : 0,
                distance_from_sma: features.distance_from_sma || 0
            };

            history.push(logEntry);
            fs.writeFileSync(LOG_FILE, JSON.stringify(history, null, 2));
            console.log(`[AI-COLLECTOR] Logged Trade Features for ${trade.symbol}`);
        } catch (e) {
            console.error("[AI-COLLECTOR] Failed to log trade:", e);
        }
    }

    // Label the result (Win/Loss)
    static labelTrade(id: string, result: { pnlPercent: number }) {
        try {
            const history = this.getHistory();
            const index = history.findIndex(t => t.id === id);

            if (index !== -1) {
                history[index].result_pnl_percent = result.pnlPercent;
                // Definition of a "Win" for AI: > 0.5% Profit (covers fees)
                history[index].target_class = result.pnlPercent > 0.5 ? 1 : 0;

                fs.writeFileSync(LOG_FILE, JSON.stringify(history, null, 2));
                console.log(`[AI-COLLECTOR] Labelled Trade ${id} as ${history[index].target_class === 1 ? 'WIN' : 'LOSS'}`);
            }
        } catch (e) {
            console.error("[AI-COLLECTOR] Failed to label trade:", e);
        }
    }

    private static getHistory(): TradeFeatureLog[] {
        if (!fs.existsSync(LOG_FILE)) return [];
        try {
            return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
        } catch {
            return [];
        }
    }
}
