
"use client";

import { RealTimeProvider } from "@/context/RealTimeContext";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <RealTimeProvider>
            {children}
        </RealTimeProvider>
    );
}
