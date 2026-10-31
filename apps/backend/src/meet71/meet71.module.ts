import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../system-health/jobs/jobs.module';
import { Meet71MembershipService } from './meet71-membership.service';
import { Meet71SsoService } from './meet71-sso.service';

@Module({
    imports: [DatabaseModule, JobsModule],
    providers: [Meet71MembershipService, Meet71SsoService],
    exports: [Meet71MembershipService, Meet71SsoService],
})
export class Meet71Module {}
