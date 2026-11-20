import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SalesModule } from '../sales/sales.module';
import { ProjectsModule } from './projects.module';
import { ProjectBillingController } from './project-billing.controller';
import { ProjectBillingService } from './project-billing.service';

/**
 * Raising a project's invoices. Apart from `ProjectsModule` so that only this
 * piece depends on Sales — the projects module itself stays free of it.
 */
@Module({
    imports: [DatabaseModule, ProjectsModule, SalesModule],
    controllers: [ProjectBillingController],
    providers: [ProjectBillingService],
})
export class ProjectBillingModule {}
