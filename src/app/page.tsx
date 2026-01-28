"use client";

import { SignalScanner } from "@/components/signal-scanner";
import { SummaryStats } from "@/components/summary-stats";
import { DataInputForm } from "@/components/data-input";
import { OIChart } from "@/components/oi-chart";
import { ExchangeTable } from "@/components/exchange-table";
import { BacktestDashboard } from "@/components/backtest-dashboard";

export default function Home() {
    return (
        <main className="min-h-screen bg-background p-6">
            <div className="max-w-7xl mx-auto space-y-6">

                <header className="flex items-center justify-between border-b border-white/10 pb-6">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Canton <span className="text-primary">Terminal</span>
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Multi-Asset Liquidation & Momentum Scanner
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <div className="px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs text-green-400 font-mono animate-pulse">
                            ● SYSTEM ONLINE
                        </div>
                    </div>
                </header>

                {/* 1. Multi-Asset Signal Scanner */}
                <SignalScanner />
            </div>
        </main>
    );
}
