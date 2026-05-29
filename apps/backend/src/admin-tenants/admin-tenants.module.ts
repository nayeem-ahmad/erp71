import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BillingModule } from '../billing/billing.module';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminMetricsController } from './admin-metrics.controller';
import { AdminTenantsService } from './admin-tenants.service';

@Module({
    imports: [
        BillingModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
            signOptions: { expiresIn: '1h' },
        }),
    ],
    controllers: [AdminTenantsController, AdminUsersController, AdminMetricsController],
    providers: [AdminTenantsService, PlatformAdminGuard],
})
export class AdminTenantsModule {}
