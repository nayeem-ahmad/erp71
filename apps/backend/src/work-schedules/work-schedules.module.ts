import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkSchedulesController } from './work-schedules.controller';
import { WorkSchedulesService } from './work-schedules.service';

@Module({
    imports: [DatabaseModule],
    controllers: [WorkSchedulesController],
    providers: [WorkSchedulesService],
    // Attendance capture (Phase 3) and overtime (Phase 4) both resolve an
    // employee's schedule through this service.
    exports: [WorkSchedulesService],
})
export class WorkSchedulesModule {}
