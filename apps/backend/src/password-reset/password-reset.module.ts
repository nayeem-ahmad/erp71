import { Module } from '@nestjs/common';
import { PasswordPolicyModule } from '../password-policy/password-policy.module';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';

@Module({
    imports: [PasswordPolicyModule],
    providers: [PasswordResetService],
    controllers: [PasswordResetController],
    exports: [PasswordResetService],
})
export class PasswordResetModule {}
