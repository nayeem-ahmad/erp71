import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { TenantsService } from './tenants.service';
import { StorefrontMediaService } from './storefront-media.service';
import { TenantsController } from './tenants.controller';

@Module({
    // AssetsModule is where a storefront hero image or logo is kept once the
    // settings page has cropped it.
    imports: [AssetsModule, DatabaseModule, SubscriptionPlansModule],
    controllers: [TenantsController],
    providers: [TenantsService, StorefrontMediaService],
})
export class TenantsModule {}
