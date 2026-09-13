import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExpenseClaimsModule } from '../expense-claims/expense-claims.module';
import { EmployeeRecordsModule } from '../employee-records/employee-records.module';
import { EmployeePortalController, EmployeePortalAdminController } from './employee-portal.controller';
import { EmployeePortalService } from './employee-portal.service';
import { EmployeeGuard } from './employee.guard';
import { EmployeeLoginService } from './employee-login.service';
import { PasswordPolicyModule } from '../password-policy/password-policy.module';

@Module({
    imports: [
        DatabaseModule,
        AttendanceModule,
        ExpenseClaimsModule,
        EmployeeRecordsModule,
        // A generated password has to satisfy whatever rule the workspace set,
        // or `create` mints a credential its own `assertValid` would refuse.
        PasswordPolicyModule,
    ],
    controllers: [EmployeePortalController, EmployeePortalAdminController],
    providers: [EmployeePortalService, EmployeeLoginService, EmployeeGuard],
})
export class EmployeePortalModule {}
