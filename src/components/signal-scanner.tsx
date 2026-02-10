import { useState, useEffect } from "react";
import { Activity } from "lucide-react";

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

                setIsLoading(false);
            } catch (e) { console.error("Sync Error", e); }
        };

        sync();
        const timer = setInterval(sync, 15000); // 15s Refresh
        return () => clearInterval(timer);
    }, []);

    // EXECUTE CLOSE
    const closePosition = async (bsPosition: any) => {
        if (!confirm(`Confirm CLOSE ${bsPosition.coin}?`)) return;

        const size = parseFloat(bsPosition.szi);
        const action = size > 0 ? "SELL" : "BUY"; // Close is opposite

        try {
            await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: bsPosition.coin + "-USD",
                    action,
                    price: 0, // Market
                    size: Math.abs(size * parseFloat(bsPosition.entryPx)), // USD Value
                    leverage: 1,
                    reduceOnly: true
                })
            });
            alert("Close Order Sent.");
        } catch (e) { alert("Error closing."); }
    };

    // EXECUTE OPEN
    const triggerTrade = async (signal: Signal) => {
        if (!confirm(`Trigger ${signal.action} ${signal.symbol}?`)) return;
        try {
            await fetch('/api/trade', {
                method: 'POST',
                body: JSON.stringify({
                    symbol: signal.symbol,
                    action: signal.action,
                    size: 50, // Fixed safe start
                    price: signal.price,
                    // CONTEXT
                    reasons: signal.reasons,
                    score: signal.score,
                    confidence: signal.confidence
                })
            });
            alert("Order Sent.");
        } catch (e) {
            alert("Trade Failed");
        }
    };

    return (
        <div className="space-y-6">
            {/* HERDER STATS */}
            <div className="flex justify-between items-center bg-zinc-900/50 p-6 rounded-xl border border-zinc-800">
                <div className="flex flex-col">
                    <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">Net Equity</span>
                    <div className="text-3xl font-mono text-white font-bold">
                        ${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="flex flex-col text-right">
                        <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">Free Margin</span>
                        <div className="text-xl font-mono text-emerald-400">
                            ${(walletData?.freeCollateral || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                    </div>
                </div>
            </div>

            {/* ACTIVE POSITIONS TABLE */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <h3 className="font-semibold text-sm flex items-center gap-2 text-zinc-200">
                        <Activity className="h-4 w-4 text-emerald-400" /> Active Positions (dYdX)
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white/5 uppercase text-[10px] text-zinc-400 tracking-wider">
                            <tr>
                                <th className="p-3">Asset</th>
                                <th className="p-3 text-right">Size</th>
                                <th className="p-3 text-right">Entry</th>
                                <th className="p-3 text-right">PnL</th>
                                <th className="p-3 text-left">Hypothesis</th>
                                <th className="p-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {activePositions.length === 0 ? (
                                <tr><td colSpan={6} className="p-6 text-center text-zinc-600 italic">No Active Positions</td></tr>
                            ) : (
                                activePositions.map((item: any, i: number) => {
                                    const p = item.position || item; // Handle nested structure
                                    const size = parseFloat(p.szi);
                                    if (size === 0) return null;
                                    const isLong = size > 0;

                                    // Reasoning Context
                                    const score = p.score || 0;
                                    const reasons = p.reasoning || [];
                                    const reasonText = reasons.slice(0, 2).join(", ") + (reasons.length > 2 ? "..." : "");

                                    return (
                                        <tr key={i} className="hover:bg-white/5">
                                            <td className="p-3 font-bold text-white">
                                                {p.coin} <span className={`text-[10px] px-1 rounded ${isLong ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>{isLong ? "LONG" : "SHORT"}</span>
                                            </td>
                                            <td className="p-3 text-right font-mono text-zinc-300">{size.toFixed(3)}</td>
                                            <td className="p-3 text-right font-mono text-zinc-300">${parseFloat(p.entryPx).toFixed(2)}</td>
                                            <td className={`p-3 text-right font-mono font-bold ${p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                ${parseFloat(p.unrealizedPnl || 0).toFixed(2)}
                                            </td>
                                            <td className="p-3 text-left text-xs text-zinc-400 max-w-[200px] truncate">
                                                {score !== 0 && <span className="font-bold text-zinc-300 mr-2">Score:{score.toFixed(1)}</span>}
                                                <span title={reasons.join("\n")}>{reasonText || "Manual / Legacy"}</span>
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
            {isLoading && <div className="text-center text-zinc-500 py-10 animate-pulse">Scanning dYdX Markets...</div>}

        </div>
    );
}
