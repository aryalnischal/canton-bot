
import { runSimulation } from "../lib/backtest-engine";

async function verifyThreeWeeks() {
    console.log("=== 🔍 3-WEEK LIVE PERFORMANCE VERIFICATION (Last 21 Days) ===");
    console.log("Strategy: 5x Leverage, Magnet Dynamic Exits");
    console.log("---------------------------------------------------------------");
    console.log("| Asset      | Timeframe | Net Profit | Win Rate | Trades |");
    console.log("|------------|-----------|------------|----------|--------|");
    console.log("| Strategy           | Net Profit | Win Rate | Max DD   |");
    console.log("|--------------------|------------|----------|----------|");

    // 21 Days * 6 candles/day (4h) = 126
    // 21 Days * 24 candles/day (1h) = 504
    // 21 Days * 96 candles/day (15m) = 2016

    const tests = [
        { asset: 'BTCUSDT', interval: '1h', limit: 504, lev: 10, label: '10x Standard' },
        { asset: 'BTCUSDT', interval: '1h', limit: 504, lev: 10, confluenceSymbol: 'ETHUSDT', label: '10x + ETH Filter' },
    ];

    for (const t of tests) {
        try {
            const res = await runSimulation(t.asset, 0, t.interval, {
                candleLimit: t.limit,
                leverage: t.lev,
                confluenceSymbol: t.confluenceSymbol
            });

            let color = "\x1b[31m"; // Red
            if (res.netProfit > 50) color = "\x1b[32m"; // Green
            else if (res.netProfit > 0) color = "\x1b[33m"; // Yellow

            const label = t.label.padEnd(20);
            const pnl = `$${res.netProfit.toFixed(1)}`.padEnd(10);
            const wr = `${res.winRate.toFixed(1)}%`.padEnd(8);

            console.log(`| ${label} | ${color}${pnl}\x1b[0m | ${wr} | ${res.totalTrades}      |`);
        } catch (e) {
            console.log(`| ${t.label.padEnd(20)} | ERROR        | N/A      | 0      |`);
        }
    }
    console.log("---------------------------------------------------------------");
    console.log("⚠️ Note: 'Net Profit' is based on $100 starting capital per trade.");
}

verifyThreeWeeks();
