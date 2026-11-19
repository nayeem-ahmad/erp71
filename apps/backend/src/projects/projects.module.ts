import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssetsModule } from '../assets/assets.module';
import { BoardsController } from './boards.controller';
import { ProjectsController } from './projects.controller';
import { ProjectStoriesController } from './project-stories.controller';
import { ProjectEpicsController } from './project-epics.controller';
import { ProjectBacklogController } from './project-backlog.controller';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectTimeController } from './project-time.controller';
import { SprintsController } from './sprints.controller';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';
import { ProjectsStaffingService } from './projects.staffing.service';
import { ProjectStoriesService } from './project-stories.service';
import { ProjectEpicsService } from './project-epics.service';
import { ProjectBacklogService } from './project-backlog.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectTimeService } from './project-time.service';
import { ProjectTimerService } from './project-timer.service';
import { LabourPricingService } from './labour-pricing.service';
import { ProjectCostingService } from './project-costing.service';
import { ProjectCostingController } from './project-costing.controller';
import { ProjectDirectCostsService } from './project-direct-costs.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { SprintsService } from './sprints.service';
import { BurndownRecorder } from './burndown-recorder.service';
import { SprintMembershipService } from './sprint-membership.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectCommentsService } from './project-comments.service';
import { ProjectAttachmentsService } from './project-attachments.service';

@Module({
    imports: [DatabaseModule, NotificationsModule, AssetsModule],
    controllers: [
        // First: `/projects/boards` would otherwise be captured by
        // ProjectsController's `:id` route.
        BoardsController,
        ProjectsController,
        ProjectStoriesController,
        ProjectEpicsController,
        ProjectBacklogController,
        ProjectTasksController,
        ProjectTimeController,
        ProjectCostingController,
        SprintsController,
    ],
    providers: [
        ProjectAccessService,
        ProjectsService,
        ProjectsStaffingService,
        BoardsService,
        BoardColumnsService,
        ProjectStoriesService,
        ProjectEpicsService,
        ProjectBacklogService,
        ProjectTasksService,
        ProjectTimeService,
        ProjectTimerService,
        LabourPricingService,
        ProjectCostingService,
        ProjectDirectCostsService,
        ProjectSettingsService,
        RemainingHoursService,
        ProjectActivityService,
        ProjectCommentsService,
        ProjectAttachmentsService,
        SprintsService,
        BurndownRecorder,
        SprintMembershipService,
    ],
    exports: [ProjectsService, RemainingHoursService, ProjectAccessService],
})
export class ProjectsModule {}
