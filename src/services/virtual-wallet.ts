
// PNL TRACKER CLASS
export class VirtualWallet {
    balance: number;
    initialBalance: number;
    equity: number;
    peakEquity: number;
    maxDrawdown: number;
    trades: any[];
    activePosition: {
        symbol: string;
        entryPrice: number;
        size: number; // USD Value
        leverage: number;
        action: 'BUY' | 'SELL';
        sl: number;
        tp: number;
        index: number;
    } | null;

    constructor(initialBalance: number = 10000) {
        this.balance = initialBalance;
        this.initialBalance = initialBalance;
        this.equity = initialBalance;
        this.peakEquity = initialBalance;
        this.maxDrawdown = 0;
        this.trades = [];
        this.activePosition = null;
    }

    updateEquity(currentPrice: number) {
        if (!this.activePosition) {
            this.equity = this.balance;
        } else {
            const pos = this.activePosition;
            let unrealizedPnL = 0;
            if (pos.action === 'BUY') {
                unrealizedPnL = (currentPrice - pos.entryPrice) / pos.entryPrice * pos.size;
            } else {
                unrealizedPnL = (pos.entryPrice - currentPrice) / pos.entryPrice * pos.size;
            }
            this.equity = this.balance + unrealizedPnL;
        }

        // Update Drawdown
        if (this.equity > this.peakEquity) this.peakEquity = this.equity;
        const dd = (this.peakEquity - this.equity) / this.peakEquity;
        if (dd > this.maxDrawdown) this.maxDrawdown = dd;
    }

    openPosition(symbol: string, action: 'BUY' | 'SELL', price: number, leverage: number, timeIndex: number) {
        if (this.activePosition) return; // Only 1 pos for backtest

        const riskAmt = this.equity * 0.20; // Use 20% of equity (Conservative Growth)
        const size = riskAmt * leverage;
        const slDist = 0.02; // 2% SL
        const tpDist = 0.04; // 4% TP

        this.activePosition = {
            symbol,
            entryPrice: price,
            size,
            leverage,
            action,
            sl: action === 'BUY' ? price * (1 - slDist) : price * (1 + slDist),
            tp: action === 'BUY' ? price * (1 + tpDist) : price * (1 - tpDist),
            index: timeIndex
        };
    }

    closePosition(price: number, reason: string, timeIndex: number) {
        if (!this.activePosition) return;

        const pos = this.activePosition;
        let pnl = 0;
        if (pos.action === 'BUY') {
            pnl = (price - pos.entryPrice) / pos.entryPrice * pos.size;
        } else {
            pnl = (pos.entryPrice - price) / pos.entryPrice * pos.size;
        }

        // Fees (0.05% Taker * 2)
        const fees = pos.size * 0.00035; // 0.035% Taker Fee
        const netPnL = pnl - fees;

        this.balance += netPnL;
        this.trades.push({
            symbol: pos.symbol,
            action: pos.action,
            entry: pos.entryPrice,
            exit: price,
            pnl: netPnL,
            pnlPercent: (netPnL / (pos.size / pos.leverage)) * 100, // ROI
            reason,
            duration: timeIndex - pos.index
        });

        this.activePosition = null;
        this.equity = this.balance;
    }
}
