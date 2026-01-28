import { TradeSignal } from "@/lib/analysis";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SignalCardProps {
    signal: TradeSignal;
}

export function SignalCard({ signal }: SignalCardProps) {
    const isBuy = signal.action === 'BUY';
    const isSell = signal.action === 'SELL';

    // Theme colors
    const bgColor = isBuy
        ? "bg-green-500/10 border-green-500/50"
        : isSell
            ? "bg-red-500/10 border-red-500/50"
            : "bg-gray-500/10 border-gray-500/50";

    const textColor = isBuy ? "text-green-500" : isSell ? "text-red-500" : "text-gray-400";

    return (
        <div className={cn("rounded-xl border p-6 backdrop-blur-sm", bgColor)}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">

                {/* Main Signal Display */}
                <div className="flex items-center gap-4">
                    <div className={cn("flex h-16 w-16 items-center justify-center rounded-full border-2", textColor, "border-current")}>
                        {isBuy && <TrendingUp className="h-8 w-8" />}
                        {isSell && <TrendingDown className="h-8 w-8" />}
                        {!isBuy && !isSell && <Minus className="h-8 w-8" />}
                    </div>
                    <div>
                        <div className="text-sm font-medium text-muted-foreground">Algorithmic Signal</div>
                        <div className={cn("text-3xl font-black tracking-tighter", textColor)}>
                            {signal.action} <span className="text-lg opacity-80">({signal.leverage})</span>
                        </div>
                        {signal.target && signal.target > 0 && (
                            <div className="text-sm font-bold text-foreground bg-background/40 px-2 py-0.5 rounded border border-white/10 mt-1 inline-block">
                                🎯 Target: ${signal.target.toLocaleString()}
                            </div>
                        )}
                        <div className="text-xs font-semibold text-muted-foreground mt-1">
                            Confidence: <span className="text-foreground">{signal.confidence.toFixed(0)}%</span>
                        </div>
                    </div>
                </div>

                {/* Reasoning Section */}
                <div className="flex-1 rounded-lg bg-background/50 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-foreground">Analysis Logic</h4>
                    <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                        {signal.reasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="mt-4 border-t border-border/50 pt-2 text-center text-[10px] text-muted-foreground/50">
                DISCLAIMER: This is an algorithmic helper. Not financial advice. Trade at your own risk.
            </div>
        </div>
    );
}
