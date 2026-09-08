import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/**
 * Window for the CRM dashboard. Both bounds are date-only (`YYYY-MM-DD`) in the
 * server's timezone; the service widens `to` to the end of that day so a
 * single-day window is not empty.
 */
export class CrmDashboardQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    /**
     * "Only my numbers" — every panel narrows to the rows the caller owns.
     *
     * A flag rather than an owner id, so the id is resolved from the session and
     * never crosses the wire: the same shape `GET /crm/lead-conversations?mine`
     * has always used. A rep cannot ask for somebody else's dashboard by editing
     * the query string, and there is no id for the client to look up first.
     */
    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true' || value === '1')
    @IsBoolean()
    mine?: boolean;
}
