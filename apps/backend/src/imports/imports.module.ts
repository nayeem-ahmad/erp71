import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { ImportsController } from './imports.controller';
import { ImportsScheduler } from './imports.scheduler';
import { ImportsService } from './imports.service';

@Module({
    // AssetsModule for document uploads; JobTrackerService and AppLogger both
    // come from @Global() modules, which is why the scheduler needs no import
    // of its own — same as ProjectsScheduler.
    imports: [AuthModule, AssetsModule],
    controllers: [ImportsController],
    providers: [ImportsService, ImportsScheduler],
    exports: [ImportsService],
})
export class ImportsModule {}
