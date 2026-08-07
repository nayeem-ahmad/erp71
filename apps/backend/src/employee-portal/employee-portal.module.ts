import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExpenseClaimsModule } from '../expense-claims/expense-claims.module';
import { EmployeeRecordsModule } from '../employee-records/employee-records.module';
import { EmployeePortalController, EmployeePortalAdminController } from './employee-portal.controller';
import { EmployeePortalService } from './employee-portal.service';
import { EmployeeGuard } from './employee.guard';

@Module({
    imports: [DatabaseModule, AttendanceModule, ExpenseClaimsModule, EmployeeRecordsModule],
    controllers: [EmployeePortalController, EmployeePortalAdminController],
    providers: [EmployeePortalService, EmployeeGuard],
})
export class EmployeePortalModule {}
