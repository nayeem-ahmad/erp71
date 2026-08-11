import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CareersJwtGuard, JobSeekerGuard } from './job-seeker.guard';
import {
    CareersAuthController,
    CareersPortalController,
    CareersPublicController,
} from './careers.controller';
import { CareersService } from './careers.service';

/**
 * The public careers board and the job seeker's portal — the applicant-facing
 * half of recruitment. The hiring workspace's half is `RecruitmentModule`, and
 * the two share the same `JobPost` / `Applicant` / `JobApplication` rows.
 *
 * `AuthModule` is imported for `JwtModule` (to sign applicant tokens) and
 * `TotpService`; `AuditModule` is global. There is deliberately no
 * `TenantInterceptor` anywhere in this module, because none of its routes
 * belong to a single workspace.
 */
@Module({
    imports: [DatabaseModule, AuthModule, AssetsModule],
    controllers: [CareersPublicController, CareersAuthController, CareersPortalController],
    providers: [CareersService, CareersJwtGuard, JobSeekerGuard],
})
export class CareersModule {}
