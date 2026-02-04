
const API_URL = "http://127.0.0.1:3001/api/trade";
const SYMBOL = "SUI-PERP";

async function getPrice(coin: string) {
    try {
        const res = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "allMids" })
        });
        const data = await res.json();
        return parseFloat(data[coin] || data[coin.replace("-PERP", "")]);
    } catch (e) { return 0; }
}

async function closeShort() {
    console.log(`🧹 COVERING SHORT ${SYMBOL}...`);
    const price = await getPrice(SYMBOL);
    console.log("Price:", price);

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: SYMBOL,
                action: 'BUY', // BUY TO CLOSE SHORT
                size: 11,
                leverage: 3,
                reduceOnly: true, // CLOSE
                price: price
            })
        });
        const data = await res.json();
        console.log("Result:", data);
    } catch (e) {
        console.error("Clean Failed:", e);
    }
}
closeShort();
