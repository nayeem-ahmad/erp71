import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkSchedulesModule } from '../work-schedules/work-schedules.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceCaptureService } from './attendance-capture.service';
import { OvertimeService } from './overtime.service';

@Module({
    imports: [DatabaseModule, WorkSchedulesModule],
    controllers: [AttendanceController],
    providers: [AttendanceService, AttendanceCaptureService, OvertimeService],
    // Exported so the employee portal can apply for and cancel leave through
    // the same validation the admin screens use.
    exports: [AttendanceService, AttendanceCaptureService, OvertimeService],
})
export class AttendanceModule {}
