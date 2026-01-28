const HL_API = "https://api.hyperliquid.xyz/info";

async function checkUniverse() {
    console.log("Fetching Hyperliquid Universe...");
    const res = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "type": "metaAndAssetCtxs" })
    });
    const data = await res.json();
    const universe = data[0].universe;

    // Search for CC
    const cc = universe.find((u: any) => u.name === 'CC' || u.name === 'CANTON' || u.name.includes('CANTON'));

    if (cc) {
        console.log("✅ FOUND ON HYPERLIQUID:", cc);
    } else {
        console.log("❌ CC NOT FOUND on Hyperliquid.");
        console.log("Total Assets:", universe.length);
    }
}

checkUniverse();
