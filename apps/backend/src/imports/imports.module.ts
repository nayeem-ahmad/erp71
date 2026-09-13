import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportsController } from './imports.controller';
import { ImportsScheduler } from './imports.scheduler';
import { ImportsService } from './imports.service';

@Module({
    imports: [AuthModule],
    // JobTrackerService and AppLogger both come from @Global() modules, which
    // is why the scheduler needs no import of its own — same as ProjectsScheduler.
    controllers: [ImportsController],
    providers: [ImportsService, ImportsScheduler],
    exports: [ImportsService],
})
export class ImportsModule {}
