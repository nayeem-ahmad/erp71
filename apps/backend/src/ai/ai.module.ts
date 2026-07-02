import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ProductsModule } from '../products/products.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';

@Module({
    imports: [forwardRef(() => PlatformSettingsModule), ProductsModule, SubscriptionPlansModule],
    controllers: [AiController],
    providers: [AiService],
    exports: [AiService],
})
export class AiModule {}
