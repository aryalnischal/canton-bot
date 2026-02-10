
import {
    CompositeClient,
    Network
} from '@dydxprotocol/v4-client-js';

async function main() {
    const client = await CompositeClient.connect(Network.mainnet());
    console.log("IndexerClient Keys:", Object.keys(client.indexerClient));
    // Also try to see inside 'account' if it exists
    if ((client.indexerClient as any).account) {
        console.log("IndexerClient.account Keys:", Object.keys((client.indexerClient as any).account));
    }
}
main();
