
const API_URL = "http://127.0.0.1:3001/api/trade";
const TARGETS = ["SUI-PERP", "ARB-PERP", "CRV-PERP", "LDO-PERP", "LINK-PERP"];

async function getPrice(coin: string) {
    try {
        const res = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "allMids" })
        });
        const data = await res.json();
        let p = parseFloat(data[coin] || data[coin.replace("-PERP", "")]);
        if (!p && coin === 'SUI-PERP') p = parseFloat(data['SUI']);
        if (!p) return 0; // Skip if totally failed
        return p;
    } catch (e) { return 0; }
}

async function closeAllLegacy() {
    console.log("🧹 CLEANING LEGACY POSITIONS...");

    for (const symbol of TARGETS) {
        // Fetch current size from API would be better, but we can just send a large ReduceOnly SELL
        // If we are Short, we BUY. User said "SELL 3x" or "SELL 1x" in the UI dump -> They are SHORT.
        // So we must BUY to close.

        console.log(`\nProcessing ${symbol}...`);
        const price = await getPrice(symbol);

        if (!price) {
            console.error(`Skipping ${symbol} (Price Error)`);
            continue;
        }

        // We assume SHORT based on user provided "SELL 1x" label in UI table
        // We will send a BUY reduceOnly. 
        // Note: If some are Long, this fits Short. We should ideally check audit-portfolio.
        // But for "ReduceOnly", if we get side wrong, it just fails. 
        // Let's try BUY (Close Short).

        try {
            console.log(`   Attempting Close (BUY/Cover Short) @ $${price}`);
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: symbol,
                    action: 'BUY', // Closing a Short
                    size: 500, // Large enough to cover $102, reduceOnly clips it
                    leverage: 1,
                    reduceOnly: true,
                    price: price * 1.05 // Slippage tolerance for market buy
                })
            });
            const data = await res.json();
            console.log(`   Result:`, data.success ? `✅ TX ${data.txHash}` : `❌ ${data.error}`);

            // If failed, maybe it was a LONG? Try Sell.
            if (!data.success && (String(data.error).includes('increase') || String(data.error).includes('Reduce only'))) {
                console.log(`   ⚠️ Retrying as SELL (Close Long)...`);
                const res2 = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        action: 'SELL', // Closing a Long
                        size: 500,
                        leverage: 1,
                        reduceOnly: true,
                        price: price * 0.95
                    })
                });
                const data2 = await res2.json();
                console.log(`   Retry Result:`, data2.success ? `✅ TX ${data2.txHash}` : `❌ ${data2.error}`);
            }

        } catch (e) {
            console.error("   Exec Failed:", e);
        }

        await new Promise(r => setTimeout(r, 1000));
    }
}

closeAllLegacy();
