import React, { useState, useEffect } from 'react';
import { Calculator, X, RefreshCw } from 'lucide-react';

export function PnLCalculator({ onClose }: { onClose: () => void }) {
    const [entry, setEntry] = useState(100);
    const [exit, setExit] = useState(110);
    const [leverage, setLeverage] = useState(10);
    const [size, setSize] = useState(1000);
    const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');

    // Constants
    const TAKER_FEE = 0.0005; // 0.05%
    const OPEN_FEE = size * TAKER_FEE;
    const CLOSE_FEE = size * TAKER_FEE; // Approx
    const TOTAL_FEES = OPEN_FEE + CLOSE_FEE;

    // Calculation
    const rawDiff = direction === 'LONG' ? (exit - entry) : (entry - exit);
    const rawPct = rawDiff / entry;
    const levPct = rawPct * leverage;

    const grossPnL = size * levPct;
    const netPnL = grossPnL - TOTAL_FEES;
    const roe = (netPnL / size) * 100; // Net ROE

    // Liq Price
    // Long: Entry * (1 - 1/Lev)
    // Short: Entry * (1 + 1/Lev)
    const liqPrice = direction === 'LONG'
        ? entry * (1 - (1 / leverage) + 0.005)
        : entry * (1 + (1 / leverage) - 0.005);

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-white/20 rounded-xl w-full max-w-md p-6 relative shadow-2xl">
                <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white"><X className="h-5 w-5" /></button>

                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <Calculator className="h-6 w-6 text-emerald-400" />
                    PnL Simulator
                </h2>

                <div className="space-y-4">
                    {/* TOGGLES */}
                    <div className="flex gap-2 p-1 bg-black/40 rounded-lg">
                        <button
                            onClick={() => setDirection('LONG')}
                            className={`flex-1 py-2 text-sm font-bold rounded ${direction === 'LONG' ? 'bg-green-500/20 text-green-400' : 'text-white/30'}`}
                        >
                            LONG 🚀
                        </button>
                        <button
                            onClick={() => setDirection('SHORT')}
                            className={`flex-1 py-2 text-sm font-bold rounded ${direction === 'SHORT' ? 'bg-red-500/20 text-red-400' : 'text-white/30'}`}
                        >
                            SHORT 🐻
                        </button>
                    </div>

                    {/* INPUTS */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-white/50 block mb-1">Entry Price ($)</label>
                            <input type="number" value={entry} onChange={e => setEntry(parseFloat(e.target.value))} className="w-full bg-black/50 border border-white/10 rounded p-2 font-mono text-white" />
                        </div>
                        <div>
                            <label className="text-xs text-white/50 block mb-1">Exit Price ($)</label>
                            <input type="number" value={exit} onChange={e => setExit(parseFloat(e.target.value))} className="w-full bg-black/50 border border-white/10 rounded p-2 font-mono text-white" />
                        </div>
                        <div>
                            <label className="text-xs text-white/50 block mb-1">Leverage (x)</label>
                            <input type="number" value={leverage} onChange={e => setLeverage(parseFloat(e.target.value))} className="w-full bg-black/50 border border-white/10 rounded p-2 font-mono text-white" />
                        </div>
                        <div>
                            <label className="text-xs text-white/50 block mb-1">Position Size ($)</label>
                            <input type="number" value={size} onChange={e => setSize(parseFloat(e.target.value))} className="w-full bg-black/50 border border-white/10 rounded p-2 font-mono text-white" />
                        </div>
                    </div>

                    {/* RESULTS CARD */}
                    <div className={`mt-6 p-4 rounded-xl border ${netPnL >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                        <div className="flex justify-between items-end mb-4">
                            <div>
                                <div className="text-xs text-white/50">Net PnL</div>
                                <div className={`text-3xl font-bold font-mono ${netPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {netPnL >= 0 ? '+' : ''}{netPnL.toFixed(2)}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-white/50">ROE %</div>
                                <div className={`text-xl font-bold ${roe >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {roe.toFixed(2)}%
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-white/10 pt-4">
                            <div>
                                <div className="text-white/30">Total Fees</div>
                                <div className="text-orange-400 font-mono">-${TOTAL_FEES.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-white/30">Liq Price</div>
                                <div className="text-red-400 font-mono font-bold">${liqPrice.toFixed(2)}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-white/30">Breakeven</div>
                                <div className="text-white font-mono">${(direction === 'LONG' ? entry * 1.001 : entry * 0.999).toFixed(2)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
