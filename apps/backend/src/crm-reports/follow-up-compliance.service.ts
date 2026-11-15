import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class FollowUpComplianceService {
    constructor(private readonly db: DatabaseService) {}

    async report(...args: any[]): Promise<any> {
        return { by_assignee: [], by_purpose: [], totals: {}, undated_open: 0 };
    }
}
