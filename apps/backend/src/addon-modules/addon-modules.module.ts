import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AddonModulesAdminController } from './addon-modules-admin.controller';
import { AddonModulesController } from './addon-modules.controller';
import { AddonModulesService } from './addon-modules.service';

@Module({
    controllers: [AddonModulesAdminController, AddonModulesController],
    providers: [AddonModulesService, PlatformAdminGuard],
    exports: [AddonModulesService],
})
export class AddonModulesModule {}
