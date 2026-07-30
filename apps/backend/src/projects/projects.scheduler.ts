import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { SprintSnapshotService } from './sprint-snapshot.service';

@Injectable()
export class ProjectsScheduler {
    constructor(
        private readonly db: DatabaseService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
        private readonly snapshots: SprintSnapshotService,
    ) {}

    /**
     * One burndown point per active sprint, nightly.
     *
     * Runs at 23:50 Dhaka (17:50 UTC) rather than after midnight so the row
     * lands on the day it describes. A failure for one sprint does not stop the
     * rest — and because the figures are derivable from the remaining-hours
     * log, a miss can be repaired later with `rebuildSnapshots`.
     */
    @Cron('50 17 * * *', { name: 'projects.sprint-snapshots' })
    async captureSprintSnapshots() {
        await this.jobTracker.track(JOB_NAMES.PROJECTS_SPRINT_SNAPSHOTS, async () => {
            const sprints = await this.db.sprint.findMany({
                where: { status: 'ACTIVE' as never },
                select: { id: true, tenant_id: true, name: true },
            });

            let written = 0;
            let failed = 0;
            for (const sprint of sprints) {
                try {
                    await this.snapshots.snapshotToday(sprint.tenant_id, sprint.id);
                    written += 1;
                } catch (error) {
                    failed += 1;
                    this.logger.error(
                        `Sprint snapshot failed for ${sprint.name} (${sprint.id})`,
                        error instanceof Error ? error.stack : String(error),
                        'ProjectsScheduler',
                    );
                }
            }

            return { sprints: sprints.length, written, failed };
        });
    }
}
