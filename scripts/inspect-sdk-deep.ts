
import {
    CompositeClient,
    Network
} from '@dydxprotocol/v4-client-js';

function getAllFuncs(toCheck: any) {
    const props = [];
    let obj = toCheck;
    do {
        props.push(...Object.getOwnPropertyNames(obj));
    } while (obj = Object.getPrototypeOf(obj));

    return props.sort().filter((e, i, arr) => (e != arr[i - 1] && typeof toCheck[e] == 'function'));
}

async function main() {
    const client = await CompositeClient.connect(Network.mainnet());

    console.log("IndexerClient Methods:");
    console.log(getAllFuncs(client.indexerClient));

    if ((client.indexerClient as any).account) {
        console.log("\nIndexerClient.account Methods:");
        console.log(getAllFuncs((client.indexerClient as any).account));
    }
}
main();
