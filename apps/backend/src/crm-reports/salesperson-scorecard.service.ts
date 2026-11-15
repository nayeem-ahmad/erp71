import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SalespersonScorecardService {
    constructor(private readonly db: DatabaseService) {}

    async report(...args: any[]): Promise<any> {
        return { rows: [], totals: {} };
    }
}
