import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({ label, value, subValue, trend }: { label: string, value: string, subValue?: string, trend?: number }) {
    const isPositive = trend && trend >= 0;
    return (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                <h3 className="tracking-tight text-sm font-medium text-muted-foreground">{label}</h3>
                {trend !== undefined && (
                    isPositive ? <ArrowUp className="h-4 w-4 text-green-500" /> : <ArrowDown className="h-4 w-4 text-red-500" />
                )}
            </div>
            <div className="flex flex-col">
                <div className="text-2xl font-bold">{value}</div>
                {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
                {trend !== undefined && (
                    <p className={cn("text-xs", isPositive ? "text-green-500" : "text-red-500")}>
                        {trend > 0 ? '+' : ''}{trend}%
                    </p>
                )}
            </div>
        </div>
    );
}

export function SummaryStats({ data }: { data?: any[] }) {
    // Calculate aggregates from data if provided, else use static fallback
    // For MVP, if data is passed, we sum it up.
    // ...
    // Actually, let's keep it static for now in this file edit and update component next.
    // I will rewrite the component in next step.
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Open Interest" value="$28.07M" subValue="212.44M CC" trend={-2.31} />
            <StatCard label="Volume (24h)" value="$260.43M" subValue="-15.4% vs 24h ago" trend={-15.4} />
            <StatCard label="Total Liquidations (24h)" value="$958.53K" subValue="Longs: $247K / Shorts: $710K" />
            <StatCard label="Long/Short Ratio" value="1.0568" subValue="Avg across exchanges" />
        </div>
    )
}
