import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { Meet71MembershipService } from './meet71-membership.service';

@Module({
    imports: [DatabaseModule],
    providers: [Meet71MembershipService],
    exports: [Meet71MembershipService],
})
export class Meet71Module {}
