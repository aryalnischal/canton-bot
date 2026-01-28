


const API_URL = "http://localhost:3001/api/v5/scan";

async function monitorBrain() {
    console.log("🧠 CONNECTING TO V5 HIVE MIND...");
    console.log("Monitoring Real-Time Intelligence (Whales, Magnets, Sentiment)...\n");

    let count = 0;
    const maxChecks = 5; // Run for ~15-20 seconds

    while (count < maxChecks) {
        try {
            const start = Date.now();
            const res = await fetch(API_URL);

            if (!res.ok) {
                console.log(`❌ API Error: ${res.status}`);
            } else {
                const data = await res.json();
                console.log(`\n--- SCAN #${count + 1} (${new Date().toLocaleTimeString()}) ---`);

                if (data.status === 'scanning') {
                    console.log("Creating new snapshot... (Server is Scanning)");
                } else if (data.signals && data.signals.length > 0) {
                    console.log(`🎯 FOUND ${data.signals.length} POTENTIAL SIGNALS:`);

                    data.signals.forEach((s: any) => {
                        const whale = s.votes.onChain === 'BULLISH' ? '🐋 BUY' : (s.votes.onChain === 'BEARISH' ? '🐋 SELL' : 'Neutral');
                        console.log(`\n   ${s.action} ${s.symbol} (Score: ${s.score.toFixed(2)} | Conf: ${s.confidence}%)`);
                        console.log(`   ├─ 🐋 Whale Vote: ${whale}`);
                        console.log(`   ├─ 📊 Logic: ${s.reasons.join(', ')}`);
                    });
                } else {
                    console.log("💤 NO SIGNALS (Market is Quiet or Filters are Strict)");
                }
            }

            count++;
            await new Promise(r => setTimeout(r, 4000)); // 4s Poll
        } catch (e) {
            console.error("Connection Failed:", e.message);
            await new Promise(r => setTimeout(r, 4000));
        }
    }

    console.log("\n✅ MONITORING COMPLETE.");
}

monitorBrain();
