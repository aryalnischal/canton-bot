
const API_URL = "http://127.0.0.1:3001/api/trade";
const SYMBOL = "SUI-PERP";
const SIZE_USD = 10.5; // Must be > $10
const LEVERAGE = 3;

async function getPrice(coin: string) {
    try {
        const res = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "allMids" })
        });
        const data = await res.json();

        let p = parseFloat(data[coin] || data[coin.replace("-PERP", "")]);
        if (!p && coin === 'SUI-PERP') p = parseFloat(data['SUI']);
        if (!p) {
            console.warn("   ⚠️ API Price Fetch Failed. Using Hard Fallback $1.15");
            return 1.15;
        }
        return p;
    } catch (e) {
        console.warn("   ⚠️ API Error. Fallback $1.15");
        return 1.15;
    }
}

async function run() {
    console.log(`\n🧪 TESTING LAYERED TP (${SYMBOL})...`);
    const price = await getPrice(SYMBOL);
    if (!price) throw new Error("Price Fetch Failed");

    // 1. OPEN (Should trigger TP placement)
    console.log(`1️⃣  OPENING LONG @ $${price}...`);
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            symbol: SYMBOL,
            action: 'BUY',
            size: SIZE_USD,
            leverage: LEVERAGE,
            price: price,
            checkDup: false,
            force: true // BYPASS COOLDOWN
        })
    });
    const data = await res.json();
    console.log("   Open Result:", data.success ? "✅ Success" : data.error);

    // 2. WAIT FOR ARMS
    console.log("   ⏳ Waiting 10s for TPs to arm...");
    await new Promise(r => setTimeout(r, 10000));

    // 3. AUDIT is manual via next command
    console.log("   👉 RUN 'audit-orders.ts' NOW TO VERIFY 3 ORDERS.");

    // 4. CLOSE (Cleanup)
    console.log(`\n4️⃣  CLOSING...`);
    // Note: We won't close automatically here to allow manual inspection in the run step.
    // Actually, I'll separate the close script or just use close-cleanup.
}

run();
