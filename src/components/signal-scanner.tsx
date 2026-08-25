import { useState, useEffect } from "react";
import { Activity, Clock, Shield, TrendingUp, Radio, History } from "lucide-react";

import { generateTradeSignal, ManualAnalysisData } from "@/lib/analysis";

interface Signal {
    symbol: string;
    action: 'BUY' | 'SELL' | 'NEUTRAL';
    price: number;
    score: number;
    reasons: string[];
    confidence: number;
}

export function SignalScanner() {
    // REAL-TIME WALLET STATE
    const [equity, setEquity] = useState(0);
    const [activePositions, setActivePositions] = useState<any[]>([]);
    const [walletData, setWalletData] = useState<any>(null);

    // SIGNALS
    const [signals, setSignals] = useState<Signal[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // PNL STATE
    const [pnlData, setPnlData] = useState<any>({ totalPnl: 0, pnl24h: 0, pnl48h: 0, winRate24h: 0 });

    // ACTIVITY FEED
    const [activityFeed, setActivityFeed] = useState<any[]>([]);

    // TRADE HISTORY
    const [tradeHistory, setTradeHistory] = useState<any[]>([]);
    const [historyStats, setHistoryStats] = useState<any>({ total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 });
    const [historyFilter, setHistoryFilter] = useState('7d'); // 'today', '7d', '30d', 'all', 'custom'
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    // 1. POLL WALLET & MARKET SCAN (Unified)
    useEffect(() => {
        const sync = async () => {
            try {
                // A. WALLET
                const wRes = await fetch('/api/wallet');
                const wData = await wRes.json();
                if (wData.success) {
                    setEquity(wData.equity);
                    setActivePositions(wData.positions || []);
                    setWalletData(wData);
                }

                // B. SCAN
                const sRes = await fetch('/api/v5/scan');
                const sData = await sRes.json();
                if (sData.success) {
                    setSignals(sData.signals);
                }

                // C. ANALYTICS (PnL)
                const pRes = await fetch('/api/analytics/pnl');
                const pData = await pRes.json();
                if (pData.success) {
                    setPnlData(pData);
                }

                // D. ACTIVITY FEED (lightweight, in-memory)
                const aRes = await fetch('/api/activity?minutes=10');
                const aData = await aRes.json();
                if (aData.success) {
                    setActivityFeed(aData.activity);
                }

                setIsLoading(false);
            } catch (e) { console.error("Sync Error", e); }
        };

        const fetchHistory = async () => {
            try {
                let params = '';
                const now = Date.now();
                if (historyFilter === 'today') {
                    const startOfDay = new Date();
                    startOfDay.setHours(0, 0, 0, 0);
                    params = `?from=${startOfDay.getTime()}`;
                } else if (historyFilter === '7d') {
                    params = `?from=${now - 7 * 86400000}`;
                } else if (historyFilter === '30d') {
                    params = `?from=${now - 30 * 86400000}`;
                } else if (historyFilter === 'custom' && customFrom) {
                    params = `?from=${new Date(customFrom).getTime()}`;
                    if (customTo) params += `&to=${new Date(customTo + 'T23:59:59').getTime()}`;
                }
                // 'all' → no params
                const hRes = await fetch(`/api/trade/history${params}`);
                const hData = await hRes.json();
                if (hData.success) {
                    setTradeHistory(hData.trades);
                    setHistoryStats(hData.stats);
                }
            } catch (e) { console.error('History fetch error', e); }
        };

        sync();
        fetchHistory();
        const timer = setInterval(sync, 15000);
        const historyTimer = setInterval(fetchHistory, 30000); // 30s for history
        return () => { clearInterval(timer); clearInterval(historyTimer); };
    }, [historyFilter, customFrom, customTo]);

    const closePosition = async (p: any) => {
        const symbol = p.market || p.ticker || p.symbol;
        if (!confirm(`Confirm CLOSE ${symbol}?`)) return;

        try {
            const tokenSize = Math.abs(parseFloat(p.szi || p.size));
            const price = parseFloat(p.oraclePrice || p.entryPx || p.entryPrice);
            const sizeUsd = tokenSize * price; // Convert token qty → USD notional

            const res = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: symbol,
                    action: p.side === 'LONG' ? 'SELL' : 'BUY',
                    size: sizeUsd,
                    price: price,
                    type: 'MARKET',
                    reduceOnly: true,
                    reason: "Manual UI Close"
                })
            });

            const data = await res.json();
            if (data.success) {
                alert("Close Order Sent!");
            } else {
                alert("Close Failed: " + (data.error || "Unknown"));
            }
        } catch (e) {
            console.error(e);
            alert("Network Error");
        }
    };

    return (
        <div className="space-y-6">
            {/* HEADER STATS */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* 1. TOTAL PORTFOLIO BALANCE */}
                <div className="bg-gradient-to-br from-zinc-900 to-zinc-800/80 p-6 rounded-xl border border-zinc-700 flex flex-col justify-between md:col-span-2 shadow-lg">
                    <span className="text-xs uppercase text-zinc-400 font-bold tracking-wider">Portfolio Balance</span>
                    <div className="text-4xl font-mono text-white font-bold mt-1">
                        ${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex justify-between items-center mt-3 text-xs text-zinc-400">
                        <span>Free: <span className="text-emerald-400 font-mono">${(walletData?.freeCollateral || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                        <span className="font-mono text-zinc-500 truncate ml-2" title={walletData?.address || ''}>
                            {walletData?.address ? `${walletData.address.slice(0, 10)}...${walletData.address.slice(-6)}` : '—'}
                        </span>
                    </div>
                </div>

                {/* 2. LIFETIME PNL */}
                <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 flex flex-col justify-between">
                    <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">Lifetime PnL</span>
                    <div className={`text-2xl font-mono font-bold ${pnlData.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pnlData.totalPnl >= 0 ? "+" : ""}${pnlData.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>

                {/* 3. 24H PERFORMANCE */}
                <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 flex flex-col justify-between">
                    <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">24h Profit</span>
                    <div className={`text-2xl font-mono font-bold ${pnlData.pnl24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pnlData.pnl24h >= 0 ? "+" : ""}${pnlData.pnl24h.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-xs text-zinc-500 text-right">Win Rate: {pnlData.winRate24h.toFixed(0)}%</span>
                </div>

                {/* 4. POSITIONS + 48H */}
                <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 flex flex-col justify-between">
                    <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">48h Profit</span>
                    <div className={`text-2xl font-mono font-bold ${pnlData.pnl48h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pnlData.pnl48h >= 0 ? "+" : ""}${pnlData.pnl48h.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-xs text-zinc-500 text-right">Positions: {activePositions.length}/3</span>
                </div>
            </div>

            {/* ACTIVE POSITIONS TABLE */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <h3 className="font-semibold text-sm flex items-center gap-2 text-zinc-200">
                        <Activity className="h-4 w-4 text-emerald-400" /> Active Positions (Hyperliquid)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white/5 uppercase text-[10px] text-zinc-400 tracking-wider">
                            <tr>
                                <th className="p-3">Asset</th>
                                <th className="p-3 text-center">Direction</th>
                                <th className="p-3 text-center">Leverage</th>
                                <th className="p-3 text-right">Size</th>
                                <th className="p-3 text-right">Entry</th>
                                <th className="p-3 text-right">PnL</th>
                                <th className="p-3 text-left">Hypothesis</th>
                                <th className="p-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {activePositions.length === 0 ? (
                                <tr><td colSpan={8} className="p-6 text-center text-zinc-600 italic">No Active Positions</td></tr>
                            ) : (
                                activePositions.map((item: any, i: number) => {
                                    const p = item.position || item; // Handle nested structure
                                    const size = parseFloat(p.szi);
                                    if (size === 0) return null;
                                    const isLong = size > 0;

                                    // Reasoning Context
                                    const score = p.score || 0;
                                    const confidence = p.confidence || 0;
                                    const leverage = typeof p.leverage === 'object' ? p.leverage.value : (p.leverage || '—');
                                    const reasons = p.reasoning || [];
                                    const reasonText = reasons.slice(0, 2).join(", ") + (reasons.length > 2 ? "..." : "");

                                    return (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-3 font-bold text-white">
                                                {p.coin}
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${isLong ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30" : "text-red-400 bg-red-500/15 border border-red-500/30"}`}>
                                                    {isLong ? "⬆ LONG" : "⬇ SHORT"}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center">
                                                <span className="font-mono font-bold text-amber-400">{leverage}x</span>
                                            </td>
                                            <td className="p-3 text-right font-mono text-zinc-300">{Math.abs(size).toFixed(3)}</td>
                                            <td className="p-3 text-right font-mono text-zinc-300">${parseFloat(p.entryPx).toFixed(2)}</td>
                                            <td className={`p-3 text-right font-mono font-bold ${p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                ${parseFloat(p.unrealizedPnl || 0).toFixed(2)}
                                            </td>
                                            <td className="p-3 text-left text-xs text-zinc-400 max-w-[250px]">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    {score !== 0 && <span className="font-bold text-zinc-300">Score:{score.toFixed(1)}</span>}
                                                    {confidence > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 font-mono">{confidence}%</span>}
                                                </div>
                                                <span className="truncate block" title={reasons.join("\n")}>{reasonText || "Manual / Legacy"}</span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <button onClick={() => closePosition(p)} className="text-[10px] border border-zinc-700 hover:bg-zinc-800 px-2 py-1 rounded text-zinc-300">Close</button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* LIVE SIGNALS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {signals.map((signal, i) => (
                    <div key={i} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col justify-between min-h-[140px]">
                        <div>
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-bold text-white">{signal.symbol}</h3>
                                <div className={`px-2 py-1 rounded text-xs font-bold ${signal.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {signal.action}
                                </div>
                            </div>
                            <div className="text-2xl font-mono text-zinc-300 mb-2">${signal.price.toFixed(4)}</div>
                            <div className="text-xs text-zinc-500 leading-relaxed">
                                {signal.reasons.join(", ")}
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-xs text-zinc-600">Score: {signal.score.toFixed(1)}</span>
                            {/* Automated Mode Indicator */}
                            <span className="text-[10px] text-zinc-500 font-mono border border-zinc-800 px-2 py-1 rounded">
                                {signal.confidence > 45 ? "AUTO-QUEUE" : "MONITORING"}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
            {isLoading && <div className="text-center text-zinc-500 py-10 animate-pulse">Scanning Hyperliquid Markets...</div>}

            {/* ACTIVITY FEED */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <h3 className="font-semibold text-sm flex items-center gap-2 text-zinc-200">
                        <Radio className="h-4 w-4 text-blue-400 animate-pulse" /> Activity Feed (Last 10 min)
                    </h3>
                    <span className="text-[10px] font-mono text-zinc-500">{activityFeed.length} events</span>
                </div>
                <div className="max-h-[240px] overflow-y-auto">
                    {activityFeed.length === 0 ? (
                        <div className="p-6 text-center text-zinc-600 italic text-sm">No recent activity — waiting for next scan cycle...</div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {activityFeed.map((entry: any, i: number) => {
                                const time = new Date(entry.timestamp).toLocaleTimeString();
                                const icon = entry.type === 'SCAN' ? <TrendingUp className="h-3.5 w-3.5 text-blue-400" /> :
                                    entry.type === 'TRADE' ? <Activity className="h-3.5 w-3.5 text-emerald-400" /> :
                                        entry.type === 'GUARD' ? <Shield className="h-3.5 w-3.5 text-amber-400" /> :
                                            <Clock className="h-3.5 w-3.5 text-zinc-400" />;
                                const color = entry.type === 'TRADE' ? 'text-emerald-400' :
                                    entry.type === 'GUARD' ? 'text-amber-400' :
                                        entry.type === 'SCAN' ? 'text-blue-400' : 'text-zinc-400';

                                return (
                                    <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                                        <div className="mt-0.5">{icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center">
                                                <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>{entry.type}</span>
                                                <span className="text-[10px] font-mono text-zinc-600">{time}</span>
                                            </div>
                                            <p className="text-xs text-zinc-300 mt-0.5 truncate">{entry.message}</p>
                                            {entry.details?.actionable && entry.details.actionable.length > 0 && (
                                                <p className="text-[10px] text-zinc-500 mt-1 truncate">
                                                    Signals: {entry.details.actionable.join(', ')}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* TRADE HISTORY */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-2 text-zinc-200">
                            <History className="h-4 w-4 text-purple-400" /> Trade History
                        </h3>
                        <span className="text-[10px] font-mono text-zinc-500">{historyStats.total} trades</span>
                    </div>
                    {/* Filter Buttons */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {['today', '7d', '30d', 'all'].map(f => (
                            <button key={f} onClick={() => setHistoryFilter(f)}
                                className={`text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider transition-colors ${historyFilter === f
                                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                                    : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300'
                                    }`}>
                                {f === 'today' ? 'Today' : f === '7d' ? '7 Days' : f === '30d' ? '30 Days' : 'All Time'}
                            </button>
                        ))}
                        <button onClick={() => setHistoryFilter('custom')}
                            className={`text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider transition-colors ${historyFilter === 'custom'
                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                                : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300'
                                }`}>
                            Custom
                        </button>
                        {historyFilter === 'custom' && (
                            <div className="flex items-center gap-2 ml-2">
                                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                                    className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 font-mono" />
                                <span className="text-zinc-600 text-[10px]">→</span>
                                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                                    className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 font-mono" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-5 gap-px bg-zinc-800/50">
                    <div className="bg-zinc-950/80 p-3 text-center">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total</div>
                        <div className="text-sm font-bold text-white font-mono">{historyStats.total}</div>
                    </div>
                    <div className="bg-zinc-950/80 p-3 text-center">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Wins</div>
                        <div className="text-sm font-bold text-emerald-400 font-mono">{historyStats.wins}</div>
                    </div>
                    <div className="bg-zinc-950/80 p-3 text-center">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Losses</div>
                        <div className="text-sm font-bold text-red-400 font-mono">{historyStats.losses}</div>
                    </div>
                    <div className="bg-zinc-950/80 p-3 text-center">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Win Rate</div>
                        <div className={`text-sm font-bold font-mono ${historyStats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{historyStats.winRate}%</div>
                    </div>
                    <div className="bg-zinc-950/80 p-3 text-center">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total PnL</div>
                        <div className={`text-sm font-bold font-mono ${historyStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {historyStats.totalPnl >= 0 ? '+' : ''}${historyStats.totalPnl.toFixed(2)}
                        </div>
                    </div>
                </div>

                {/* Trade Table */}
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white/5 uppercase text-[10px] text-zinc-400 tracking-wider sticky top-0 bg-zinc-900">
                            <tr>
                                <th className="p-3">Date</th>
                                <th className="p-3">Asset</th>
                                <th className="p-3 text-center">Direction</th>
                                <th className="p-3 text-center">Lev</th>
                                <th className="p-3 text-right">Entry</th>
                                <th className="p-3 text-right">Exit</th>
                                <th className="p-3 text-right">PnL</th>
                                <th className="p-3 text-left">Reason</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {tradeHistory.length === 0 ? (
                                <tr><td colSpan={8} className="p-6 text-center text-zinc-600 italic">No closed trades in this period</td></tr>
                            ) : (
                                tradeHistory.map((t: any, i: number) => {
                                    const isLong = t.action === 'BUY';
                                    const exitDate = t.exitTime ? new Date(t.exitTime) : null;
                                    return (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-3 text-[11px] font-mono text-zinc-400">
                                                {exitDate ? `${exitDate.toLocaleDateString()} ${exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                                            </td>
                                            <td className="p-3 font-bold text-white">{t.symbol?.split('-')[0]}</td>
                                            <td className="p-3 text-center">
                                                <span className={`inline-block px-2 py-0.5 rounded font-bold text-[10px] ${isLong ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30' : 'text-red-400 bg-red-500/15 border border-red-500/30'}`}>
                                                    {isLong ? '⬆ LONG' : '⬇ SHORT'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center font-mono font-bold text-amber-400">{t.leverage || '—'}x</td>
                                            <td className="p-3 text-right font-mono text-zinc-300">${t.entryPrice?.toFixed(2)}</td>
                                            <td className="p-3 text-right font-mono text-zinc-300">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}</td>
                                            <td className={`p-3 text-right font-mono font-bold ${t.pnlValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {t.pnlValue >= 0 ? '+' : ''}${t.pnlValue?.toFixed(2) || '0.00'}
                                                <span className="text-[10px] text-zinc-500 ml-1">({t.pnlPercent?.toFixed(1) || '0'}%)</span>
                                            </td>
                                            <td className="p-3 text-left text-[11px] text-zinc-500 max-w-[150px] truncate" title={t.exitReason}>
                                                {t.exitReason || '—'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}
