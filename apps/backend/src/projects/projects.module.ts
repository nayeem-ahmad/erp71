import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssetsModule } from '../assets/assets.module';
import { BoardsController } from './boards.controller';
import { ProjectsController } from './projects.controller';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTimeController } from './project-time.controller';
import { SprintsController } from './sprints.controller';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectTimeService } from './project-time.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { SprintsService } from './sprints.service';
import { SprintSnapshotService } from './sprint-snapshot.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectCommentsService } from './project-comments.service';
import { ProjectAttachmentsService } from './project-attachments.service';
import { ProjectsScheduler } from './projects.scheduler';

@Module({
    imports: [DatabaseModule, NotificationsModule, AssetsModule],
    controllers: [
        // First: `/projects/boards` would otherwise be captured by
        // ProjectsController's `:id` route.
        BoardsController,
        ProjectsController,
        ProjectTasksController,
        ProjectTimeController,
        SprintsController,
    ],
    providers: [
        ProjectAccessService,
        ProjectsService,
        BoardsService,
        BoardColumnsService,
        ProjectTasksService,
        ProjectTimeService,
        ProjectSettingsService,
        RemainingHoursService,
        ProjectActivityService,
        ProjectCommentsService,
        ProjectAttachmentsService,
        SprintsService,
        SprintSnapshotService,
        ProjectsScheduler,
    ],
    exports: [ProjectsService, RemainingHoursService, ProjectAccessService],
})
export class ProjectsModule {}
