import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyRateLimitGuard } from './api-key-rate-limit.guard';

@Module({
    imports: [AuthModule],
    controllers: [ApiKeysController],
    providers: [ApiKeysService, ApiKeyRateLimitGuard],
    exports: [ApiKeysService, ApiKeyRateLimitGuard],
})
export class ApiKeysModule {}
