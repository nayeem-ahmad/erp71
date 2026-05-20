import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
    providers: [InvitationsService],
    controllers: [InvitationsController],
})
export class InvitationsModule {}
