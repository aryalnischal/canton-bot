"use client";

import { ExchangeMetric } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

interface ExchangeTableProps {
    data: ExchangeMetric[];
}

export function ExchangeTable({ data }: ExchangeTableProps) {
    return (
        <div className="w-full overflow-auto rounded-lg border bg-card text-card-foreground shadow-sm">
            <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                    <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Rank</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Exchange</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Pair</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Price</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Funding</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Volume (24h)</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">OI</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">L/S Ratio</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Liquidations (L/S)</th>
                    </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                    {data.map((item) => (
                        <tr key={item.exchange} className="border-b transition-colors hover:bg-muted/50">
                            <td className="p-4 align-middle font-medium">{item.rank}</td>
                            <td className="p-4 align-middle">
                                <div className="flex items-center gap-2">
                                    {/* Placeholder for icon */}
                                    <span className="font-semibold">{item.exchange}</span>
                                </div>
                            </td>
                            <td className="p-4 align-middle text-muted-foreground">{item.pair}</td>
                            <td className="p-4 align-middle text-right">
                                <div className="flex flex-col items-end">
                                    <span>${item.price.toFixed(5)}</span>
                                    <span className={cn("text-xs", item.priceChange24h >= 0 ? "text-green-500" : "text-red-500")}>
                                        {item.priceChange24h}%
                                    </span>
                                </div>
                            </td>
                            <td className="p-4 align-middle text-right">
                                <span className={cn(
                                    item.fundingRate > 0 ? "text-orange-400" : item.fundingRate < 0 ? "text-green-500" : "text-muted-foreground"
                                )}>
                                    {(item.fundingRate * 100).toFixed(4)}%
                                </span>
                            </td>
                            <td className="p-4 align-middle text-right">
                                <div className="flex flex-col items-end">
                                    <span>${(item.volume24h / 1000000).toFixed(2)}M</span>
                                    <span className={cn("text-xs", item.volumeChange24h >= 0 ? "text-green-500" : "text-red-500")}>
                                        {item.volumeChange24h > 0 ? '+' : ''}{item.volumeChange24h}%
                                    </span>
                                </div>
                            </td>
                            <td className="p-4 align-middle text-right">
                                <div className="flex flex-col items-end">
                                    <span>${(item.openInterest / 1000000).toFixed(2)}M</span>
                                    <span className={cn("text-xs", item.openInterestChange24h >= 0 ? "text-green-500" : "text-red-500")}>
                                        {item.openInterestChange24h > 0 ? '+' : ''}{item.openInterestChange24h}%
                                    </span>
                                </div>
                            </td>
                            <td className="p-4 align-middle text-right font-medium">
                                {item.longShortRatio.toFixed(4)}
                            </td>
                            <td className="p-4 align-middle text-right">
                                <div className="flex flex-col items-end gap-1 text-xs">
                                    <span className="text-green-500">L: ${item.longLiq24h.toLocaleString()}</span>
                                    <span className="text-red-500">S: ${item.shortLiq24h.toLocaleString()}</span>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
