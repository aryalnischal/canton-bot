"use client";

import { useMarketData } from "@/hooks/use-market-data";
import { ArrowUpRight, TrendingUp, TrendingDown, Award } from "lucide-react";
import { useMemo } from "react";

interface DailyPerformanceProps {
    history: any[];
    closedHistory: any[];
    currentEquity?: number; // Optional to avoid break if not passed
}

export function DailyPerformance({ history, closedHistory, currentEquity }: DailyPerformanceProps) {
    // const INITIAL_PORTFOLIO = 250; // Deprecated
    const startBalance = 250; // Baseline for PnL Calc, or use currentEquity if we want total value
    const walletBalance = currentEquity || 250; // Fallback to 250 (Active Config) - 1000 was misleading
    const { data } = useMarketData('AUTO');

    const stats = useMemo(() => {
        if ((!history || history.length === 0) && (!closedHistory || closedHistory.length === 0)) return null;

        let totalPnL = 0;
        let wins = 0;
        let losses = 0;
        let bestTrade = { symbol: '', pnl: -Infinity };
        let worstTrade = { symbol: '', pnl: Infinity };

        // 1. Process Active Trades (Unrealized)
        history.forEach(h => {
            const currentMetric = data[h.symbol];
            if (!currentMetric) return;

            const currentPrice = currentMetric.price;
            const lev = parseInt(h.leverage) || 1;
            const rawChange = (currentPrice - h.price) / h.price;
            const pnlPercent = (h.action === 'BUY' ? rawChange : -rawChange) * lev;
            const size = h.size || 100;
            const pnlValue = pnlPercent * size;

            totalPnL += pnlValue;
            if (pnlValue > 0) wins++; else losses++;
            if (pnlValue > bestTrade.pnl) bestTrade = { symbol: h.symbol, pnl: pnlValue };
            if (pnlValue < worstTrade.pnl) worstTrade = { symbol: h.symbol, pnl: pnlValue };
        });

        // 2. Process Closed Trades (Realized) - Last 24h Only
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        closedHistory.forEach(h => {
            if (h.exitTime < oneDayAgo) return; // Skip old trades

            const pnlValue = h.pnlValue || 0;
            totalPnL += pnlValue;

            if (pnlValue > 0) wins++; else losses++;
            if (pnlValue > bestTrade.pnl) bestTrade = { symbol: h.symbol, pnl: pnlValue };
            if (pnlValue < worstTrade.pnl) worstTrade = { symbol: h.symbol, pnl: pnlValue };
        });

        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

        return { totalPnL, winRate, totalTrades, bestTrade, worstTrade };
    }, [history, closedHistory, data]);

    if (!stats || stats.totalTrades === 0) {
        return (
            <div className="p-4 rounded-xl border border-white/10 bg-black/20 text-center text-gray-400 text-sm">
                No trades in 24h history to analyze.
            </div>
        );
    }

    const isProfitable = stats.totalPnL >= 0;

    return (
        <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden mb-6">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <Award className="h-5 w-5 text-yellow-400" />
                    24h Performance Review
                </h3>
                <span className="text-xs text-gray-400">Based on Live Signals</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
                {/* Net PnL */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="text-xs text-gray-400 mb-1">Net PnL (Est)</div>
                    <div className={`text-2xl font-mono font-bold ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfitable ? '+' : ''}${stats.totalPnL.toFixed(2)}
                    </div>
                </div>

                {/* Win Rate */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="text-xs text-gray-400 mb-1">Win Rate</div>
                    <div className="text-2xl font-mono font-bold text-white">
                        {stats.winRate.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-500">{stats.totalTrades} Trades</div>
                </div>

                {/* Best Trade */}
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <div className="text-xs text-emerald-400 mb-1 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" /> Best Trade
                    </div>
                    <div className="text-lg font-bold text-white">
                        {stats.bestTrade.symbol.replace('USDT', '')}
                    </div>
                    <div className="text-sm font-mono text-emerald-400">
                        +${stats.bestTrade.pnl.toFixed(2)}
                    </div>
                </div>

                {/* Worst Trade */}
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="text-xs text-red-400 mb-1 flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" /> Worst Trade
                    </div>
                    <div className="text-lg font-bold text-white">
                        {stats.worstTrade.symbol.replace('USDT', '')}
                    </div>
                    <div className="text-sm font-mono text-red-400">
                        ${stats.worstTrade.pnl.toFixed(2)}
                    </div>
                </div>
            </div>
        </div>
    );
}
