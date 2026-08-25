// Shared HyperliquidExecutionService Singleton
// Prevents multiple wallet/client connections across API routes.

import { HyperliquidExecutionService } from '@/services/hyperliquid-execution';

let instance: HyperliquidExecutionService | null = null;

export function getEngine(): HyperliquidExecutionService {
    if (!instance) {
        instance = new HyperliquidExecutionService();
    }
    return instance;
}
