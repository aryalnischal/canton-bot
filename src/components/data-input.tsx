import { useState } from "react";
import { ManualAnalysisData, generateTradeSignal, simulateBacktest, BacktestResult } from "@/lib/analysis";
import { HISTORICAL_SCENARIOS } from "@/lib/scenarios";
import { ArrowRight, History, TrendingUp, AlertTriangle } from "lucide-react";

interface DataInputFormProps {
    onUpdate: (symbol: string, data: ManualAnalysisData) => void;
}

export function DataInputForm({ onUpdate }: DataInputFormProps) {
    const [symbol, setSymbol] = useState("CC/USDT");
    const [price, setPrice] = useState("");
    const [change, setChange] = useState("");
    const [funding, setFunding] = useState("");
    const [liqResPrice, setLiqResPrice] = useState("");
    const [liqSupPrice, setLiqSupPrice] = useState("");

    // Multi-Timeframe Max Pain Inputs
    const [liq15m, setLiq15m] = useState("");
    const [liq1h, setLiq1h] = useState("");
    const [liq4h, setLiq4h] = useState("");
    const [liq1d, setLiq1d] = useState(""); // Replaces liq1w for Daily/Trend

    const [strategy, setStrategy] = useState<'SCALP' | 'SWING'>('SCALP');

    // Backtest State
    const [showBacktest, setShowBacktest] = useState(false);
    const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);

    const loadScenario = (idx: number) => {
        const s = HISTORICAL_SCENARIOS[idx];
        setPrice(s.data.manualPrice?.toString() || "");
        setChange(s.data.manualChange?.toString() || ""); // Set Change
        setFunding(s.data.manualFunding?.toString() || "");
        setLiqResPrice(s.data.liqResistancePrice?.toString() || "");
        setLiqSupPrice(s.data.liqSupportPrice?.toString() || "");
        setStrategy(s.data.strategy || 'SCALP');
    };

    const handleSubmit = () => {
        // Validation: Need at least price
        if (!price && !change) return;

        onUpdate(symbol, {
            manualPrice: parseFloat(price) || undefined,
            manualChange: parseFloat(change) || undefined,
            manualFunding: parseFloat(funding) || undefined,
            liqResistancePrice: parseFloat(liqResPrice) || undefined,
            liqSupportPrice: parseFloat(liqSupPrice) || undefined,
            liq15m: parseFloat(liq15m) || undefined,
            liq1h: parseFloat(liq1h) || undefined,
            liq4h: parseFloat(liq4h) || undefined,
            // bias: 'LONG', // Optional bias if needed
            strategy,
        });
    };

    return (
        <div className="rounded-xl border bg-card/50 p-4 backdrop-blur-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Manual Alpha Input</h3>

            {/* Scenarios */}
            <div className="mb-4 flex flex-wrap gap-2">
                {HISTORICAL_SCENARIOS.map((s, i) => (
                    <button
                        key={i}
                        onClick={() => loadScenario(i)}
                        className="flex items-center gap-1 rounded-full border bg-background/50 px-3 py-1 text-[10px] hover:bg-muted"
                    >
                        <History className="h-3 w-3" /> {s.name}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex items-center gap-4 rounded-lg border bg-muted/50 p-2">
                <span className="text-xs font-medium text-muted-foreground">Timeframe / Style:</span>
                <div className="flex gap-1">
                    <button
                        onClick={() => setStrategy('SCALP')}
                        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${strategy === 'SCALP' ? 'bg-primary text-primary-foreground' : 'hover:bg-background'}`}
                    >
                        SCALP (Intraday)
                    </button>
                    <button
                        onClick={() => setStrategy('SWING')}
                        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${strategy === 'SWING' ? 'bg-primary text-primary-foreground' : 'hover:bg-background'}`}
                    >
                        SWING (Multi-day)
                    </button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-5">
                <div className="md:col-span-1">
                    <label className="text-xs text-muted-foreground font-bold text-white">Asset Symbol</label>
                    <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        className="w-full rounded border border-primary/50 bg-background px-2 py-1 text-sm font-bold text-primary"
                        placeholder="CC/USDT"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Current Price ($)</label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="0.131"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Price Change (%)</label>
                    <input
                        type="number"
                        value={change}
                        onChange={(e) => setChange(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="-5.5"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Funding Rate (%)</label>
                    <input
                        type="number"
                        value={funding}
                        onChange={(e) => setFunding(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="0.014"
                    />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Liq Target Up ($)</label>
                    <input
                        type="number"
                        value={liqResPrice}
                        onChange={(e) => setLiqResPrice(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="0.144"
                    />
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4 mt-2 border-t border-white/10 pt-3">
                <div className="md:col-span-4 text-xs font-bold text-amber-500 mb-1">
                    CoinGlass Max Pain / Liquidation Levels (Optional)
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">15m Pain Level ($)</label>
                    <input type="number" value={liq15m} onChange={(e) => setLiq15m(e.target.value)} className="w-full rounded border bg-background px-2 py-1 text-sm" placeholder="Short-Term" />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">1h Pain Level ($)</label>
                    <input type="number" value={liq1h} onChange={(e) => setLiq1h(e.target.value)} className="w-full rounded border bg-background px-2 py-1 text-sm" placeholder="Intraday" />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">4h Pain Level ($)</label>
                    <input type="number" value={liq4h} onChange={(e) => setLiq4h(e.target.value)} className="w-full rounded border bg-background px-2 py-1 text-sm" placeholder="Swing" />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">1d Pain Level ($)</label>
                    <input type="number" value={liq1d} onChange={(e) => setLiq1d(e.target.value)} className="w-full rounded border bg-background px-2 py-1 text-sm" placeholder="Daily" />
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-1 mt-2">
                <div>
                    <label className="text-xs text-muted-foreground">Liq Target Down ($) (Short Squeeze / Max Pain)</label>
                    <input
                        type="number"
                        value={liqSupPrice}
                        onChange={(e) => setLiqSupPrice(e.target.value)}
                        className="w-full rounded border bg-background px-2 py-1 text-sm"
                        placeholder="0.126"
                    />
                </div>
            </div>

            <button
                onClick={handleSubmit}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded bg-primary py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
                Run Manual Analysis <ArrowRight className="h-4 w-4" />
            </button>

            {/* Backtest Section */}
            <div className="mt-8 border-t pt-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Strategy Verification ($1k)
                    </h3>
                    <button
                        onClick={() => {
                            const results = simulateBacktest(HISTORICAL_SCENARIOS, 1000);
                            setBacktestResults(results);
                            setShowBacktest(true);
                        }}
                        className="text-xs text-primary underline hover:text-primary/80"
                    >
                        Run Top Asset Backtest
                    </button>
                </div>

                {showBacktest && (
                    <div className="mt-4 space-y-2 rounded bg-background/40 p-3 text-xs">
                        <div className="grid grid-cols-5 font-bold text-muted-foreground pb-2 border-b">
                            <span className="col-span-1">Scenario</span>
                            <span>Signal</span>
                            <span>Duration</span>
                            <span>Result</span>
                            <span className="text-right">Balance</span>
                        </div>
                        {backtestResults.map((res, i) => (
                            <div key={i} className="grid grid-cols-5 items-center py-1 border-b border-white/5 last:border-0">
                                <span className="truncate pr-2 col-span-1" title={res.scenarioName}>{res.scenarioName.split(' ')[0]}</span>
                                <span className={res.signal === 'BUY' ? 'text-green-400' : res.signal === 'SELL' ? 'text-red-400' : 'text-gray-400'}>
                                    {res.signal}
                                </span>
                                <span className="text-muted-foreground">{res.duration}</span>
                                <span className={res.isWin ? 'text-green-500 font-bold' : 'text-red-500'}>
                                    {res.isWin ? 'WIN' : 'LOSS'} (${res.pnl > 0 ? '+' : ''}{res.pnl.toFixed(0)})
                                </span>
                                <span className="text-right font-mono">${res.finalBalance.toFixed(0)}</span>
                            </div>
                        ))}
                        <div className="pt-2 flex justify-between font-bold text-primary">
                            <span>Net Profit:</span>
                            <span>${(backtestResults[backtestResults.length - 1]?.finalBalance - 1000).toFixed(2)} (+{((backtestResults[backtestResults.length - 1]?.finalBalance - 1000) / 10).toFixed(1)}%)</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
