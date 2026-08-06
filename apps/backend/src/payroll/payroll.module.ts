import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommonModule } from '../common/common.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './salary-structures.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';

@Module({
    // AttendanceModule for OvertimeService: the payroll run freezes the month
    // and reads its snapshot.
    imports: [DatabaseModule, CommonModule, AttendanceModule],
    controllers: [SalaryStructuresController, PayrollRunsController],
    providers: [SalaryStructuresService, PayrollRunsService],
    exports: [SalaryStructuresService, PayrollRunsService],
})
export class PayrollModule {}
