import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceCaptureService } from './attendance-capture.service';

@Module({
    imports: [DatabaseModule, WorkSchedulesModule],
    controllers: [AttendanceController],
    providers: [AttendanceService, AttendanceCaptureService],
    // Exported so the employee portal can apply for and cancel leave through
    // the same validation the admin screens use.
    exports: [AttendanceService, AttendanceCaptureService],
})
export class AttendanceModule {}
