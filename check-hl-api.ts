
const HL_API = "https://api.hyperliquid.xyz/info";

async function checkApi() {
    try {
        console.log("Fetching HL Meta...");
        const res = await fetch(HL_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ "type": "metaAndAssetCtxs" })
        });

        const data = await res.json();
        const universe = data[0].universe; // Asset List
        const ctxs = data[1];             // Asset Contexts

        console.log("UNIVERSE SIZE:", universe.length);
        console.log("Searching for ZEC...");
        const zecAsset = universe.find((u: any) => u.name.includes('ZEC'));
        if (zecAsset) {
            console.log("✅ FOUND ZEC IN UNIVERSE:", JSON.stringify(zecAsset));
        } else {
            console.log("❌ ZEC NOT FOUND IN UNIVERSE LIST.");
        }

        // Also print first 10 for sanity
        console.log("First 10 Assets:", universe.slice(0, 10).map((u: any) => u.name).join(", "));

        if (btcIdx !== -1) {
            console.log("\n--- BTC DATA STRUCTURE ---");
            console.log(JSON.stringify(ctxs[btcIdx], null, 2));
        }

        if (solIdx !== -1) {
            console.log("\n--- SOL DATA STRUCTURE ---");
            console.log(JSON.stringify(ctxs[solIdx], null, 2));
        }

    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

checkApi();
