"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { ExchangeMetric } from "@/lib/types";

interface OIChartProps {
    data: ExchangeMetric[];
}

export function OIChart({ data }: OIChartProps) {
    // Sort data by OI descending
    const sortedData = [...data].sort((a, b) => b.openInterest - a.openInterest);

    return (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-4">
                <h3 className="text-lg font-medium text-card-foreground">Open Interest by Exchange</h3>
                <p className="text-sm text-muted-foreground">Distribution of CC futures positions</p>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sortedData}>
                        <XAxis
                            dataKey="exchange"
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `$${(value / 1000000).toFixed(0)}M`}
                        />
                        <Tooltip
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                            formatter={(value: any) => [`$${(value / 1000000).toFixed(2)}M`, 'Open Interest']}
                        />
                        <Bar
                            dataKey="openInterest"
                            fill="currentColor"
                            radius={[4, 4, 0, 0]}
                            className="fill-primary"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
