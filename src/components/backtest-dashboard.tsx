"use client";

import { useState } from "react";
import { runSimulation, SummaryReport } from "@/lib/backtest-engine";
import { SUPPORTED_ASSETS } from "@/lib/api";
import { Play, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";

export function BacktestDashboard() {
    const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS[0]);
    const [duration, setDuration] = useState(1); // Months
    const [report, setReport] = useState<SummaryReport | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    const handleRun = async () => {
        setIsRunning(true);
        // Map 1M/3M/6M/1Y to duration param (logic inside runSimulation handles limit)
        // 1 = 1 Month (Limit 720)
        // 12 = 1 Year (Limit 8760 -> Max 1500 for now)
        const res = await runSimulation(selectedAsset, duration);
        setReport(res);
        setIsRunning(false);
    };

    return (
        <div className="rounded-xl border border-white/10 bg-black/20 p-6 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-indigo-400" />
                        Historical Backtester (5x Leverage)
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Simulate strategy performance on past {duration} Month(s) data. ($100/trade)
                    </p>
                </div>

                <div className="flex gap-4 items-center bg-white/5 p-2 rounded-lg">
                    <select
                        className="bg-transparent border border-white/10 rounded px-2 py-1 text-sm"
                        value={selectedAsset}
                        onChange={(e) => setSelectedAsset(e.target.value)}
                    >
                        {SUPPORTED_ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>

                    <select
                        className="bg-transparent border border-white/10 rounded px-2 py-1 text-sm"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                    >
                        <option value={1}>Last 1 Month</option>
                        <option value={3}>Last 3 Months</option>
                        <option value={6}>Last 6 Months</option>
                        <option value={12}>Last 1 Year</option>
                    </select>

                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-bold transition-colors disabled:opacity-50"
                    >
                        {isRunning ? 'Running...' : <><Play className="h-3 w-3" /> Run Simulation</>}
                    </button>
                </div>
            </div>

            {report && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <StatBox label="Net Profit" value={`$${report.netProfit.toFixed(2)}`} good={report.netProfit > 0} />
                        <StatBox label="Win Rate" value={`${report.winRate.toFixed(1)}%`} good={report.winRate > 50} />
                        <StatBox label="Total Trades" value={report.totalTrades.toString()} good={true} />
                        <StatBox label="Max Drawdown" value={`-$${report.maxDrawdown.toFixed(2)}`} good={false} />
                    </div>

                    <div className="rounded-lg border border-white/10 overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white/5 text-muted-foreground">
                                <tr>
                                    <th className="p-3">Type</th>
                                    <th className="p-3">Entry</th>
                                    <th className="p-3">Exit</th>
                                    <th className="p-3">Duration</th>
                                    <th className="p-3 text-right">PnL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.trades.slice().reverse().slice(0, 5).map(t => (
                                    <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                                        <td className={`p-3 font-semibold ${t.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                                            {t.side}
                                        </td>
                                        <td className="p-3">${t.entryPrice.toFixed(2)}</td>
                                        <td className="p-3">${t.exitPrice.toFixed(2)}</td>
                                        <td className="p-3">{t.durationHours.toFixed(1)}h</td>
                                        <td className={`p-3 text-right font-mono font-bold ${t.status === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>
                                            {t.status === 'WIN' ? '+' : ''}{t.pnlUsd.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="p-2 text-center text-xs text-muted-foreground bg-white/5">
                            Showing last 5 trades of {report.totalTrades}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatBox({ label, value, good }: { label: string, value: string, good: boolean }) {
    return (
        <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">{label}</div>
            <div className={`text-2xl font-mono font-bold ${good ? 'text-green-400' : 'text-foreground'}`}>
                {value}
            </div>
        </div>
    );
}
