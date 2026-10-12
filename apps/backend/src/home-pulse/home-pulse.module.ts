import { Module } from '@nestjs/common';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { ProductsModule } from '../products/products.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CrmActivitiesModule } from '../crm-activities/crm-activities.module';
import { ProjectsModule } from '../projects/projects.module';
import { HomePulseController } from './home-pulse.controller';
import { HomePulseService } from './home-pulse.service';

@Module({
    imports: [SubscriptionPlansModule, ProductsModule, AccountingModule, CrmActivitiesModule, ProjectsModule],
    controllers: [HomePulseController],
    providers: [HomePulseService],
})
export class HomePulseModule {}
