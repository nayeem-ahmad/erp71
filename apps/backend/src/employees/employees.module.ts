import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeLinkService } from './employee-link.service';
import { EmployeeCostRatesService } from './employee-cost-rates.service';
import { OrgStructureImportService } from './org-structure-import.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [EmployeesController],
    providers: [EmployeesService, EmployeeLinkService, EmployeeCostRatesService, OrgStructureImportService],
    // Recruitment creates employees at the point of hire and goes through this
    // service so employee codes and payroll visibility stay in one place.
    exports: [EmployeesService],
})
export class EmployeesModule {}
