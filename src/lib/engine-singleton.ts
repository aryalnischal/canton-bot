// Shared DydxExecutionService Singleton
// Prevents multiple wallet/client connections across API routes.

import { DydxExecutionService } from '@/services/dydx-execution';

let instance: DydxExecutionService | null = null;

export function getEngine(): DydxExecutionService {
    if (!instance) {
        instance = new DydxExecutionService();
    }
    return instance;
}
