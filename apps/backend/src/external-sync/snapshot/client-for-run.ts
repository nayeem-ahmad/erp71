import type { ProviderClient } from '../provider-adapter';
import { SnapshotClient } from './snapshot-client';
import { snapshotFilePath } from './snapshot-file';

export async function clientForRun(args: {
    snapshotId: string | null;
    tenantId: string;
    connection: {
        id: string;
        provider: string;
        base_url: string;
        username: string;
        password_encrypted: string;
        external_org_id: string | null;
    };
    decrypt: (cipher: string) => string;
    createLiveClient: (creds: { baseUrl: string; username: string; password: string }) => ProviderClient;
}): Promise<ProviderClient> {
    if (!args.snapshotId) {
        return args.createLiveClient({
            baseUrl: args.connection.base_url,
            username: args.connection.username,
            password: args.decrypt(args.connection.password_encrypted),
        });
    }

    try {
        return await SnapshotClient.fromFile(snapshotFilePath(args.tenantId, args.snapshotId));
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('Snapshot file is missing on disk');
        }
        throw error;
    }
}
