import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
    imports: [DatabaseModule],
    controllers: [AttendanceController],
    providers: [AttendanceService],
    // Exported so the employee portal can apply for and cancel leave through
    // the same validation the admin screens use.
    exports: [AttendanceService],
})
export class AttendanceModule {}
