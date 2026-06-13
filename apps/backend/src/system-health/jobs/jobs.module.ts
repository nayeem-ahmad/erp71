import { Global, Module } from '@nestjs/common';
import { JobTrackerService } from './job-tracker.service';

/**
 * Global so any feature module with cron jobs can inject JobTrackerService
 * without importing this module explicitly. DatabaseService is provided by the
 * @Global() DatabaseModule.
 */
@Global()
@Module({
    providers: [JobTrackerService],
    exports: [JobTrackerService],
})
export class JobsModule {}
