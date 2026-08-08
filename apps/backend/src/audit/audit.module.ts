import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AdminAuditController } from './admin-audit.controller';

@Global()
@Module({
    controllers: [AuditController, AdminAuditController],
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
