import { Module } from '@nestjs/common';
import { CrmPhotosController } from './crm-photos.controller';
import { CrmPhotosService } from './crm-photos.service';
import { AssetsModule } from '../assets/assets.module';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';

@Module({
    imports: [AssetsModule],
    controllers: [CrmPhotosController],
    providers: [CrmPhotosService, SubscriptionAccessGuard],
    // Exported so the leads and contacts services can reuse
    // `assertTenantPhotoKey` rather than each re-deriving the prefix rule.
    exports: [CrmPhotosService],
})
export class CrmPhotosModule {}
