import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
    imports: [DatabaseModule],
    controllers: [AttendanceController],
    providers: [AttendanceService],
})
export class AttendanceModule {}
