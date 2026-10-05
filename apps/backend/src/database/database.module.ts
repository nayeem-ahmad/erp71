import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TenantTimezoneService } from './tenant-timezone.service';
import { AuthCacheService } from './auth-cache.service';
import { BranchScopeService } from './branch-scope.service';

@Global()
@Module({
    // `AuthCacheService` lives here rather than in `AuthModule` because its
    // readers are not all in one module — `StorePermissionGuard` and
    // `TenantInterceptor` are instantiated by every feature module that lists
    // them — and its writers are spread across a dozen more. Global, like the
    // database itself, so none of them has to import anything to reach it.
    providers: [DatabaseService, TenantTimezoneService, AuthCacheService, BranchScopeService],
    exports: [DatabaseService, TenantTimezoneService, AuthCacheService, BranchScopeService],
})
export class DatabaseModule { }
