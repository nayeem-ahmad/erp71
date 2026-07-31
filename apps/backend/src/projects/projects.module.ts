import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProjectsController } from './projects.controller';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTimeController } from './project-time.controller';
import { SprintsController } from './sprints.controller';
import { ProjectsService } from './projects.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectTimeService } from './project-time.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { SprintsService } from './sprints.service';
import { SprintSnapshotService } from './sprint-snapshot.service';
import { ProjectsScheduler } from './projects.scheduler';

@Module({
    imports: [DatabaseModule],
    controllers: [
        ProjectsController,
        ProjectTasksController,
        ProjectTimeController,
        SprintsController,
    ],
    providers: [
        ProjectsService,
        ProjectTasksService,
        ProjectTimeService,
        ProjectSettingsService,
        RemainingHoursService,
        SprintsService,
        SprintSnapshotService,
        ProjectsScheduler,
    ],
    exports: [ProjectsService, RemainingHoursService],
})
export class ProjectsModule {}
