import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../system-health/jobs/jobs.module';
import { Meet71AdminController } from './meet71-admin.controller';
import { Meet71InternalController } from './meet71-internal.controller';
import { Meet71MembershipService } from './meet71-membership.service';
import { Meet71ServiceGuard } from './meet71-service.guard';
import { Meet71SsoService } from './meet71-sso.service';
import { Meet71Controller } from './meet71.controller';

@Module({
    imports: [DatabaseModule, JobsModule],
    controllers: [Meet71Controller, Meet71InternalController, Meet71AdminController],
    providers: [Meet71MembershipService, Meet71SsoService, Meet71ServiceGuard],
    exports: [Meet71MembershipService, Meet71SsoService],
})
export class Meet71Module {}
