"use client";

import { useEffect, useRef, useState } from "react";
// import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, XCircle, AlertTriangle, CheckCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogEntry {
    id: string;
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'crit';
    message: string;
    meta?: any;
}

export function ActivityLog({ className }: { className?: string }) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleLog = (e: Event) => {
            const customEvent = e as CustomEvent;
            const detail = customEvent.detail;

            const newLog: LogEntry = {
                id: Math.random().toString(36).substr(2, 9),
                timestamp: detail.timestamp,
                level: detail.level,
                message: detail.message,
                meta: detail.meta
            };

            setLogs(prev => [newLog, ...prev].slice(0, 100)); // Keep last 100
        };

        window.addEventListener('canton-log', handleLog);

        // Initial Startup Log
        setLogs([{
            id: 'init',
            timestamp: Date.now(),
            level: 'info',
            message: 'System Monitor Active. Listening for events...'
        }]);

        return () => window.removeEventListener('canton-log', handleLog);
    }, []);

    // Auto-Scroll (if needed, but usually latest on top is better for dashboards)

    return (
        <div className={cn("flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden", className)}>
            <div className="flex items-center px-4 py-2 bg-slate-900 border-b border-slate-800">
                <Terminal className="w-4 h-4 text-slate-400 mr-2" />
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">System Activity</span>
                <div className="ml-auto flex items-center gap-2">
                    <Activity className="w-3 h-3 text-green-500 animate-pulse" />
                    <span className="text-[10px] text-green-500">LIVE</span>
                </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto" ref={scrollRef}>
                <div className="space-y-1">
                    {logs.map(log => (
                        <div key={log.id} className="flex items-start text-xs font-mono group hover:bg-slate-900/50 p-1 rounded transition-colors">
                            <span className="text-slate-600 w-16 shrink-0">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>

                            <div className="mr-2 mt-0.5 shrink-0">
                                {log.level === 'crit' && <CheckCircle className="w-3 h-3 text-green-400" />}
                                {log.level === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                {log.level === 'warn' && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                                {log.level === 'info' && <div className="w-1.5 h-1.5 rounded-full bg-slate-600 m-0.5" />}
                            </div>

                            <div className="flex-1 break-all">
                                <span className={cn(
                                    log.level === 'crit' ? "text-green-300 font-bold" :
                                        log.level === 'error' ? "text-red-400" :
                                            log.level === 'warn' ? "text-yellow-300" :
                                                "text-slate-300"
                                )}>
                                    {log.message}
                                </span>
                                {log.meta && Object.keys(log.meta).length > 0 && (
                                    <pre className="mt-1 text-[10px] text-slate-500 ml-4 hidden group-hover:block">
                                        {JSON.stringify(log.meta, null, 2)}
                                    </pre>
                                )}
                            </div>
                        </div>
                    ))}

                    {logs.length === 0 && (
                        <div className="text-center text-slate-600 py-8">
                            No recent activity
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
