
"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { exchangeSocket } from '../services/exchange-socket';
import { ExchangeMetric } from '../lib/types';

interface RealTimeContextType {
    marketData: Record<string, Partial<ExchangeMetric>>;
    userData: any; // Hyperliquid WebData2 State
    isConnected: boolean;
    subscribeTo: (symbols: string[]) => void;
    subscribeToUser: (address: string) => void;
}

const RealTimeContext = createContext<RealTimeContextType>({
    marketData: {},
    userData: null,
    isConnected: false,
    subscribeTo: () => { },
    subscribeToUser: () => { }
});

export const useRealTime = () => useContext(RealTimeContext);

export function RealTimeProvider({ children }: { children: React.ReactNode }) {
    const [marketData, setMarketData] = useState<Record<string, Partial<ExchangeMetric>>>({});
    const [userData, setUserData] = useState<any>(null); // New User State
    const [isConnected, setIsConnected] = useState(false);

    // Buffer for high-frequency updates
    const updateBuffer = useRef<Record<string, Partial<ExchangeMetric>>>({});

    useEffect(() => {
        // Init Socket
        exchangeSocket.connect();
        setIsConnected(true);

        // Subscribe to Market updates
        const unsubscribeMarket = exchangeSocket.subscribe((data) => {
            if (data.symbol) {
                updateBuffer.current[data.symbol] = {
                    ...updateBuffer.current[data.symbol],
                    ...data
                };
            }
        });

        // Subscribe to User updates (Direct Set, no buffer needed for state)
        // We only start receiving events if someone calls subscribeToUser
        const unsubscribeUser = exchangeSocket.subscribeUser((data) => {
            // console.log("[WS] User Data Received", data);
            setUserData(data);
        });

        // Throttled Flush Loop (4 times per second = 250ms)
        const flushInterval = setInterval(() => {
            const now = Date.now();
            if (Object.keys(updateBuffer.current).length > 0) {
                setMarketData(prev => {
                    const next = { ...prev };
                    Object.entries(updateBuffer.current).forEach(([sym, metric]) => {
                        next[sym] = { ...next[sym], ...metric, timestamp: now };
                    });
                    return next;
                });
                updateBuffer.current = {};
            }
        }, 250);

        return () => {
            unsubscribeMarket();
            unsubscribeUser();
            clearInterval(flushInterval);
            exchangeSocket.disconnect();
        };
    }, []);

    const subscribeTo = (symbols: string[]) => {
        exchangeSocket.subscribeTo(symbols);
    };

    const subscribeToUser = (address: string) => {
        exchangeSocket.subscribeToUserState(address);
    };

    return (
        <RealTimeContext.Provider value={{ marketData, userData, isConnected, subscribeTo, subscribeToUser }}>
            {children}
        </RealTimeContext.Provider>
    );
}
