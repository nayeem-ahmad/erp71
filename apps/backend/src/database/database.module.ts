import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TenantTimezoneService } from './tenant-timezone.service';

@Global()
@Module({
    providers: [DatabaseService, TenantTimezoneService],
    exports: [DatabaseService, TenantTimezoneService],
})
export class DatabaseModule { }
