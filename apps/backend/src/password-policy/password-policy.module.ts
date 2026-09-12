import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PasswordPolicyService } from './password-policy.service';

@Module({
    imports: [DatabaseModule],
    providers: [PasswordPolicyService],
    exports: [PasswordPolicyService],
})
export class PasswordPolicyModule {}
