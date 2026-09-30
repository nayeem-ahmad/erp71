/**
 * Routes that are open to every member of a workspace — authenticated, but with no
 * permission or role required — and why. See `route-authorization.spec.ts`.
 *
 * This list may only shrink. A route belongs here only when it is genuinely meant
 * for every member (a self-scoped read, the sidebar layout), or its permission is
 * enforced somewhere the scanner cannot see (the service layer). Anything marked
 * TODO is a gap to close, not a decision.
 */
export const OPEN_ROUTES: Record<string, string> = {
    'AccountController.requestDeletion': "self-scoped: acts only on the signed-in member’s own data", // DELETE /account/data-deletion-request
    'AccountController.exportData': "self-scoped: acts only on the signed-in member’s own data", // GET /account/data-export
    'ActivationController.getStatus': "activation state feeds the banner every member sees; submitting asserts MANAGE_USERS in the service", // GET /activation/status
    'ActivationController.submitRequest': "activation state feeds the banner every member sees; submitting asserts MANAGE_USERS in the service", // POST /activation/requests
    'AddonModulesController.listCatalog': "catalogue of purchasable add-ons and the workspace’s own subscriptions", // GET /addon-modules
    'AddonModulesController.listMine': "catalogue of purchasable add-ons and the workspace’s own subscriptions", // GET /addon-modules/mine
    'AiController.getUsage': "self-scoped conversations; per-tool permission is checked in the chat service", // GET /ai/usage
    'AiController.narrateReport': "self-scoped conversations; per-tool permission is checked in the chat service", // POST /ai/narrate-report
    'AiController.draftMessage': "self-scoped conversations; per-tool permission is checked in the chat service", // POST /ai/draft-message
    'AiController.parseVoiceEntry': "self-scoped conversations; per-tool permission is checked in the chat service", // POST /ai/parse-voice-entry
    'AiController.parseVoiceSale': "self-scoped conversations; per-tool permission is checked in the chat service", // POST /ai/parse-voice-sale
    'AiController.chat': "self-scoped conversations; per-tool permission is checked in the chat service", // POST /ai/chat
    'AiController.chatTools': "self-scoped conversations; per-tool permission is checked in the chat service", // GET /ai/chat/tools
    'AiController.listConversations': "self-scoped conversations; per-tool permission is checked in the chat service", // GET /ai/chat/conversations
    'AiController.getConversation': "self-scoped conversations; per-tool permission is checked in the chat service", // GET /ai/chat/conversations/:id
    'AiController.deleteConversation': "self-scoped conversations; per-tool permission is checked in the chat service", // DELETE /ai/chat/conversations/:id
    'AssetsController.uploadFile': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /assets/upload
    'AuditController.list': "permission is enforced in the service layer, not by a decorator", // GET /audit-logs
    'AuthController.logout': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/logout
    'AuthController.setupStore': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/setup-store
    'AuthController.setupTenant': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/setup-tenant
    'AuthController.dismissOnboarding': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/onboarding/dismiss
    'AuthController.getMe': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // GET /auth/me
    'AuthController.updateProfile': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // PATCH /auth/me
    'AuthController.changePassword': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/change-password
    'AuthController.resendVerification': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/resend-verification
    'AuthController.totpSetup': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/2fa/setup
    'AuthController.totpEnable': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/2fa/enable
    'AuthController.totpDisable': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // POST /auth/2fa/disable
    'AuthController.updateAvatar': "sign-in session and account bootstrap for the signed-in user (no workspace data)", // PATCH /auth/me/avatar
    'BillingController.getSummary': "plan summary is shown in the shell; checkout, refund and cancel assert MANAGE_USERS in the service", // GET /billing/summary
    'BillingController.createCheckoutSession': "plan summary is shown in the shell; checkout, refund and cancel assert MANAGE_USERS in the service", // POST /billing/checkout-session
    'BillingController.confirmCheckout': "plan summary is shown in the shell; checkout, refund and cancel assert MANAGE_USERS in the service", // POST /billing/confirm
    'BillingController.cancelAtPeriodEnd': "plan summary is shown in the shell; checkout, refund and cancel assert MANAGE_USERS in the service", // POST /billing/cancel-at-period-end
    'BillingController.processRefund': "plan summary is shown in the shell; checkout, refund and cancel assert MANAGE_USERS in the service", // POST /billing/refund
    'BlogController.listUpdates': "shell read: the What’s-new feed shown to every member", // GET /blog/updates
    'BlogController.unread': "shell read: the What’s-new feed shown to every member", // GET /blog/updates/unread
    'BlogController.markSeen': "shell read: the What’s-new feed shown to every member", // POST /blog/updates/seen
    'DemoDataController.load': "loading demo data asserts OWNER in the service; the reads are status only", // POST /tenants/demo-data
    'DemoDataController.status': "loading demo data asserts OWNER in the service; the reads are status only", // GET /tenants/demo-data/status
    'DemoDataController.batches': "loading demo data asserts OWNER in the service; the reads are status only", // GET /tenants/demo-data/batches
    'DemoDataController.options': "loading demo data asserts OWNER in the service; the reads are status only", // GET /tenants/demo-data/options
    'TenantExternalSyncController.getMatchCandidates': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/match-candidates
    'TenantExternalSyncController.applyMatchDecisions': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/match-decisions
    'TenantExternalSyncController.listProviders': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/providers
    'TenantExternalSyncController.getConnection': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync
    'TenantExternalSyncController.upsertConnection': "every handler asserts OWNER in the service (assertAllowed)", // PUT /tenants/external-sync
    'TenantExternalSyncController.deleteConnection': "every handler asserts OWNER in the service (assertAllowed)", // DELETE /tenants/external-sync
    'TenantExternalSyncController.testConnection': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/test
    'TenantExternalSyncController.startRun': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/runs
    'TenantExternalSyncController.listRuns': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/runs
    'TenantExternalSyncController.cancelRun': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/runs/:runId/cancel
    'TenantExternalSyncController.startExtract': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/snapshots
    'TenantExternalSyncController.listSnapshots': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/snapshots
    'TenantExternalSyncController.getSnapshot': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/snapshots/:id
    'TenantExternalSyncController.cancelExtract': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/snapshots/:id/cancel
    'TenantExternalSyncController.downloadSnapshot': "every handler asserts OWNER in the service (assertAllowed)", // GET /tenants/external-sync/snapshots/:id/file
    'TenantExternalSyncController.uploadSnapshot': "every handler asserts OWNER in the service (assertAllowed)", // POST /tenants/external-sync/snapshots/upload
    'TenantExternalSyncController.deleteSnapshot': "every handler asserts OWNER in the service (assertAllowed)", // DELETE /tenants/external-sync/snapshots/:id
    'FeedbackController.create': "any member may submit feedback", // POST /feedback
    'InvitationsController.listMembers': "permission is enforced in the service layer, not by a decorator", // GET /invitations/members
    'InvitationsController.listPending': "permission is enforced in the service layer, not by a decorator", // GET /invitations/pending
    'InvitationsController.updateMemberRole': "permission is enforced in the service layer, not by a decorator", // PATCH /invitations/members/:userId/role
    'InvitationsController.invite': "permission is enforced in the service layer, not by a decorator", // POST /invitations/send
    'InvitationsController.cancel': "permission is enforced in the service layer, not by a decorator", // DELETE /invitations/:id
    'InvitationsController.accept': "permission is enforced in the service layer, not by a decorator", // POST /invitations/accept
    'NavigationController.getLayout': "shell read: the sidebar layout every member needs to render the app", // GET /navigation/layout
    'NotificationsController.list': "self-scoped: acts only on the signed-in member’s own data", // GET /notifications
    'NotificationsController.unreadCount': "self-scoped: acts only on the signed-in member’s own data", // GET /notifications/unread-count
    'NotificationsController.markAllRead': "self-scoped: acts only on the signed-in member’s own data", // PATCH /notifications/read-all
    'NotificationsController.markRead': "self-scoped: acts only on the signed-in member’s own data", // PATCH /notifications/:id/read
    'SalesSettingsController.get': "shell read: the POS flags every page needs to lay out the sales menu", // GET /sales-settings
    'SmsCreditController.getSummary': "balance is shown wherever SMS is sent; purchases assert MANAGE_USERS in the service", // GET /sms-credits/summary
    'SmsCreditController.createPurchase': "balance is shown wherever SMS is sent; purchases assert MANAGE_USERS in the service", // POST /sms-credits/purchase
    'SmsCreditController.confirmPurchase': "balance is shown wherever SMS is sent; purchases assert MANAGE_USERS in the service", // POST /sms-credits/confirm
    'SupportController.listThreads': "the shop-wide support inbox is shared by every member by design (revisit: TODO.md)", // GET /support/threads
    'SupportController.stream': "the shop-wide support inbox is shared by every member by design (revisit: TODO.md)", // GET /support/stream
    'SupportController.createThread': "the shop-wide support inbox is shared by every member by design (revisit: TODO.md)", // POST /support/threads
    'SupportController.getMessages': "the shop-wide support inbox is shared by every member by design (revisit: TODO.md)", // GET /support/threads/:id/messages
    'SupportController.sendMessage': "the shop-wide support inbox is shared by every member by design (revisit: TODO.md)", // POST /support/threads/:id/messages
    'TeamController.listMembers': "permission is enforced in the service layer, not by a decorator", // GET /team/members
    'TeamController.listStores': "permission is enforced in the service layer, not by a decorator", // GET /team/stores
    'TeamController.listRoles': "permission is enforced in the service layer, not by a decorator", // GET /team/roles
    'TeamController.createRole': "permission is enforced in the service layer, not by a decorator", // POST /team/roles
    'TeamController.updateRoleTemplate': "permission is enforced in the service layer, not by a decorator", // PATCH /team/roles/:id
    'TeamController.deleteRole': "permission is enforced in the service layer, not by a decorator", // DELETE /team/roles/:id
    'TeamController.listInvitations': "permission is enforced in the service layer, not by a decorator", // GET /team/invitations
    'TeamController.invite': "permission is enforced in the service layer, not by a decorator", // POST /team/invitations
    'TeamController.revokeInvitation': "permission is enforced in the service layer, not by a decorator", // DELETE /team/invitations/:id
    'TeamController.getMember': "permission is enforced in the service layer, not by a decorator", // GET /team/members/:userId
    'TeamController.updateRole': "permission is enforced in the service layer, not by a decorator", // PATCH /team/members/:userId/role
    'TeamController.updateRoles': "permission is enforced in the service layer, not by a decorator", // PATCH /team/members/:userId/roles
    'TeamController.grantStoreAccess': "permission is enforced in the service layer, not by a decorator", // POST /team/members/:userId/stores
    'TeamController.revokeStoreAccess': "permission is enforced in the service layer, not by a decorator", // DELETE /team/members/:userId/stores/:storeId
    'TeamController.setStorePermissions': "permission is enforced in the service layer, not by a decorator", // PUT /team/members/:userId/stores/:storeId/permissions
    'TeamController.removeMember': "permission is enforced in the service layer, not by a decorator", // DELETE /team/members/:userId
    'TenantsController.getStorefrontSettings': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/storefront-settings
    'TenantsController.getBranding': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/branding
    'TenantsController.getTaxSettings': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/tax-settings
    'TenantsController.getLocalizationSettings': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/localization-settings
    'TenantsController.getDashboardSettings': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/dashboard-settings
    'TenantsController.updateDashboardSettings': "asserts OWNER/MANAGER in the service (tenants.service)", // PATCH /tenants/dashboard-settings
    'TenantsController.getPasswordPolicy': "shell read: every page needs it to render, whatever the member’s role", // GET /tenants/password-policy
    'TenantsController.updatePasswordPolicy': "asserts OWNER/MANAGER in the service (tenants.service)", // PATCH /tenants/password-policy
    'TenantsController.clearData': "shell read: every page needs it to render, whatever the member’s role", // DELETE /tenants/data
};
