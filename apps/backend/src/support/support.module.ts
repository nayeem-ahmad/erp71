import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { SupportController } from './support.controller';
import { AdminSupportController } from './admin-support.controller';
import { SupportService } from './support.service';

@Module({
    imports: [DatabaseModule, PlatformSettingsModule],
    controllers: [SupportController, AdminSupportController],
    providers: [SupportService],
    exports: [SupportService],
})
export class SupportModule implements OnModuleInit {
    private readonly logger = new Logger(SupportModule.name);

    constructor(private readonly support: SupportService) {}

    async onModuleInit() {
        try {
            const created = await this.support.backfillFeedbackThreads();
            if (created > 0) {
                this.logger.log(`Backfilled ${created} feedback thread(s)`);
            }
        } catch (err) {
            this.logger.warn(`Feedback thread backfill skipped: ${err}`);
        }
    }
}
