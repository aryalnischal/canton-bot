
import { CompositeClient, Network } from '@dydxprotocol/v4-client-js';
import * as fs from 'fs';

function inspect(obj: any, depth = 0, maxDepth = 4, seen = new WeakSet()): any {
    if (depth > maxDepth) return "...";
    if (obj === null) return "null";
    if (typeof obj !== 'object' && typeof obj !== 'function') return typeof obj;
    if (seen.has(obj)) return "[Circular]";

    seen.add(obj);

    const res: any = {};
    for (const key of Object.getOwnPropertyNames(obj)) {
        try {
            const val = obj[key];
            if (typeof val === 'function') {
                res[key] = "FUNCTION";
            } else if (typeof val === 'object') {
                res[key] = inspect(val, depth + 1, maxDepth, seen);
            } else {
                res[key] = val;
            }
        } catch (e) {
            res[key] = "[Error Accessing]";
        }
    }

    // Also check prototype for getters if it's an instance
    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== Object.prototype) {
        res["__proto__"] = inspect(proto, depth + 1, maxDepth, seen);
    }

    return res;
}

async function main() {
    const client = await CompositeClient.connect(Network.mainnet());
    const dump = inspect(client.validatorClient, 0, 5);
    fs.writeFileSync('sdk-dump.json', JSON.stringify(dump, null, 2));
    console.log("Dumped to sdk-dump.json");
}

main();
