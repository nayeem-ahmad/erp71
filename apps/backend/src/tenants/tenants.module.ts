import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

@Module({
    imports: [DatabaseModule, SubscriptionPlansModule],
    controllers: [TenantsController],
    providers: [TenantsService],
})
export class TenantsModule {}
