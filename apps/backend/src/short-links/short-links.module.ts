import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { ShortLinksService } from './short-links.service';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksAdminController } from './short-links-admin.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [ShortLinksController, ShortLinksAdminController],
    providers: [ShortLinksService, SubscriptionAccessGuard],
    exports: [ShortLinksService],
})
export class ShortLinksModule {}
