import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeePortalController, EmployeePortalAdminController } from './employee-portal.controller';
import { EmployeePortalService } from './employee-portal.service';
import { EmployeeGuard } from './employee.guard';

@Module({
    imports: [DatabaseModule, AttendanceModule],
    controllers: [EmployeePortalController, EmployeePortalAdminController],
    providers: [EmployeePortalService, EmployeeGuard],
})
export class EmployeePortalModule {}
