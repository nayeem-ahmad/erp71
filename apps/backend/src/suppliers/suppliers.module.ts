import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierScopeService } from './supplier-scope.service';

@Module({
    imports: [DatabaseModule],
    controllers: [SuppliersController],
    providers: [SuppliersService, SupplierScopeService],
    exports: [SuppliersService, SupplierScopeService],
})
export class SuppliersModule {}