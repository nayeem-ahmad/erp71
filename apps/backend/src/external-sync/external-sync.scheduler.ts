import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { ExternalSyncService } from './external-sync.service';

/**
 * Rolling-window pull for every enabled connection.
 *
 * The provider filters on document business date and hides deleted rows, so a
 * short window alone would miss both back-dated edits and upstream deletions.
 * The nightly job therefore re-pulls the connection's whole `window_days`
 * range rather than only "since last run" — re-importing an unchanged document
 * is cheap because the id mapping makes it an update in place.
 */
@Injectable()
export class ExternalSyncScheduler {
    private readonly logger = new Logger(ExternalSyncScheduler.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly externalSyncService: ExternalSyncService,
    ) {}

    @Cron('0 2 * * *')
    async runEnabledConnections() {
        const connections = await this.db.externalSyncConnection.findMany({
            where: { enabled: true },
            select: { id: true, tenant_id: true },
        });

        if (connections.length === 0) return;
        this.logger.log(`Starting scheduled external sync for ${connections.length} connection(s)`);

        for (const connection of connections) {
            try {
                await this.externalSyncService.startRun(connection.tenant_id, {}, 'SCHEDULED');
            } catch (error: any) {
                // A ConflictException here just means the previous run is still
                // going; anything else is worth surfacing in the logs.
                this.logger.warn(
                    `Scheduled external sync skipped for tenant ${connection.tenant_id}: ${error?.message ?? error}`,
                );
            }
        }
    }
}
