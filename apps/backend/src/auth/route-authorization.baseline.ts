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
    'ActivationController.getStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /activation/status
    'ActivationController.submitRequest': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /activation/requests
    'AddonModulesController.listCatalog': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /addon-modules
    'AddonModulesController.listMine': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /addon-modules/mine
    'AddonModulesController.cancel': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /addon-modules/:code/cancel-at-period-end
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
    'ApiKeysController.listKeys': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /api-keys
    'ApiKeysController.createKey': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /api-keys
    'ApiKeysController.revokeKey': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /api-keys/:id
    'AssetsController.uploadFile': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /assets/upload
    'AttendanceController.listPunches': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/punches
    'AttendanceController.listPunchDay': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/punches/day
    'AttendanceController.createPunch': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/punches
    'AttendanceController.updatePunch': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/punches/:id
    'AttendanceController.deletePunch': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /attendance/punches/:id
    'AttendanceController.listOvertime': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/overtime
    'AttendanceController.generateOvertime': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/overtime/generate
    'AttendanceController.reviewOvertime': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/overtime/:id/review
    'AttendanceController.listSnapshots': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/month-snapshot
    'AttendanceController.buildSnapshots': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/month-snapshot/build
    'AttendanceController.freezeMonth': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/month-snapshot/freeze
    'AttendanceController.unfreezeMonth': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/month-snapshot/unfreeze
    'AttendanceController.leaveCalendar': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/leave-calendar
    'AttendanceController.carryForward': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/leave-carry-forward
    'AttendanceController.getSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/settings
    'AttendanceController.updateSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/settings
    'AttendanceController.listLeaveTypes': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/leave-types
    'AttendanceController.createLeaveType': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/leave-types
    'AttendanceController.updateLeaveType': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/leave-types/:id
    'AttendanceController.deleteLeaveType': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /attendance/leave-types/:id
    'AttendanceController.upsertAttendance': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance
    'AttendanceController.listAttendance': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance
    'AttendanceController.getAttendanceSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/summary/:employeeId
    'AttendanceController.deleteAttendance': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /attendance/:id
    'AttendanceController.listLeaveBalances': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/leave-balances/:employeeId
    'AttendanceController.setLeaveBalance': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/leave-balances
    'AttendanceController.createLeaveRequest': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /attendance/leave-requests
    'AttendanceController.listLeaveRequests': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /attendance/leave-requests
    'AttendanceController.reviewLeaveRequest': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/leave-requests/:id/review
    'AttendanceController.cancelLeaveRequest': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /attendance/leave-requests/:id/cancel
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
    'BillingController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /billing/summary
    'BillingController.createCheckoutSession': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /billing/checkout-session
    'BillingController.confirmCheckout': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /billing/confirm
    'BillingController.cancelAtPeriodEnd': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /billing/cancel-at-period-end
    'BillingController.processRefund': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /billing/refund
    'BlogController.listUpdates': "shell read: the What’s-new feed shown to every member", // GET /blog/updates
    'BlogController.unread': "shell read: the What’s-new feed shown to every member", // GET /blog/updates/unread
    'BlogController.markSeen': "shell read: the What’s-new feed shown to every member", // POST /blog/updates/seen
    'BrandsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /brands
    'BrandsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /brands/import
    'BrandsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /brands
    'BrandsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /brands/:id
    'BrandsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /brands/:id
    'BrandsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /brands/:id
    'CashierSessionsController.openSession': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /cashier-sessions/open
    'CashierSessionsController.closeSession': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /cashier-sessions/:sessionId/close
    'CashierSessionsController.getOpenSession': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/open
    'CashierSessionsController.getSessionsByStore': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/store/:storeId
    'CashierSessionsController.getOpenSessionsByStore': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/store/:storeId/open
    'CashierSessionsController.getSessionById': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/:sessionId
    'CashierSessionsController.getSessionSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/:sessionId/summary
    'CashierSessionsController.addCashTransaction': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /cashier-sessions/:sessionId/cash-transaction
    'CashierSessionsController.getCashTransactions': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /cashier-sessions/:sessionId/cash-transactions
    'CountersController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /counters
    'CountersController.findByStore': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /counters
    'CountersController.findActive': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /counters/active
    'CountersController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /counters/:id
    'CountersController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /counters/:id
    'CrmCampaignsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/campaigns
    'CrmCampaignsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/campaigns
    'CrmCampaignsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/campaigns/:id
    'CrmCampaignsController.previewRecipients': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/campaigns/:id/preview
    'CrmCampaignsController.send': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/campaigns/:id/send
    'CrmCampaignsController.cancel': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/campaigns/:id/cancel
    'CrmCampaignsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/campaigns/:id
    'CrmCampaignsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/campaigns/:id
    'CrmContactsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/contacts
    'CrmContactsController.scanCard': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/contacts/scan-card
    'CrmContactsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/contacts/import
    'CrmContactsController.bulkAction': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/contacts/bulk-actions
    'CrmContactsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/contacts
    'CrmContactsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/contacts/:id
    'CrmContactsController.listAttachments': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/contacts/:id/attachments
    'CrmContactsController.addAttachment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/contacts/:id/attachments
    'CrmContactsController.removeAttachment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/contacts/:id/attachments/:attachmentId
    'CrmContactsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/contacts/:id
    'CrmContactsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/contacts/:id
    'CrmFollowUpsController.getTodaySummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/follow-ups/summary
    'CrmFollowUpsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/follow-ups
    'CrmFollowUpsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/follow-ups
    'CrmFollowUpsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/follow-ups/:id
    'CrmFollowUpsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/follow-ups/:id
    'CrmFollowUpsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/follow-ups/:id
    'CrmInteractionsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/interactions
    'CrmInteractionsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/interactions
    'CrmInteractionsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/interactions/:id
    'CrmInteractionsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/interactions/:id
    'CrmInteractionsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/interactions/:id
    'CrmLeadConversationsController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/lead-conversations/summary
    'CrmLeadConversationsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/lead-conversations
    'CrmLeadConversationsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/lead-conversations
    'CrmLeadConversationsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/lead-conversations/:id
    'CrmLeadConversationsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/lead-conversations/:id
    'CrmLeadConversationsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/lead-conversations/:id
    'CrmLeadTaxonomyController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/lead-taxonomy/:kind
    'CrmLeadsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/leads
    'CrmLeadsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/leads/import
    'CrmLeadsController.bulkAction': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/leads/bulk-actions
    'CrmLeadsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/leads
    'CrmLeadsController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/leads/summary
    'CrmLeadsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/leads/:id
    'CrmLeadsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /crm/leads/:id
    'CrmLeadsController.convert': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/leads/:id/convert
    'CrmLeadsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /crm/leads/:id
    'CrmMessageTemplatesController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /crm/message-templates
    'CrmPhotosController.upload': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /crm/photos
    'CustomFieldsController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /custom-fields
    'CustomerGroupsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customer-groups
    'CustomerGroupsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customer-groups/import
    'CustomerGroupsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customer-groups
    'CustomerGroupsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customer-groups/:id
    'CustomerGroupsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /customer-groups/:id
    'CustomerGroupsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /customer-groups/:id
    'CustomersController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customers
    'CustomersController.getSegmentStats': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/segment-stats
    'CustomersController.runSegmentation': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customers/run-segmentation
    'CustomersController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers
    'CustomersController.listCreditPayments': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/credit/payments
    'CustomersController.getCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/credit/payments/:paymentId
    'CustomersController.updateCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /customers/credit/payments/:paymentId
    'CustomersController.deleteCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /customers/credit/payments/:paymentId
    'CustomersController.evaluateSegments': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customers/segments/evaluate
    'CustomersController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customers/import
    'CustomersController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/:id
    'CustomersController.getHistory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/:id/history
    'CustomersController.getAnalytics': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/:id/analytics
    'CustomersController.getCreditLedger': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/:id/credit
    'CustomersController.getGlLedger': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/:id/gl-ledger
    'CustomersController.recordCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /customers/:id/credit/payment
    'CustomersController.getDueAgingReport': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /customers/reports/due-aging
    'CustomersController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /customers/:id
    'DeliveryController.listDeliveries': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /delivery
    'DeliveryController.getDelivery': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /delivery/:id
    'DeliveryController.createDelivery': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /delivery
    'DeliveryController.updateDelivery': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /delivery/:id
    'DeliveryController.cancelDelivery': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /delivery/:id
    'DemoDataController.load': "permission is enforced in the service layer, not by a decorator", // POST /tenants/demo-data
    'DemoDataController.status': "permission is enforced in the service layer, not by a decorator", // GET /tenants/demo-data/status
    'DemoDataController.batches': "permission is enforced in the service layer, not by a decorator", // GET /tenants/demo-data/batches
    'DemoDataController.options': "permission is enforced in the service layer, not by a decorator", // GET /tenants/demo-data/options
    'DiscountCodesController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /discount-codes
    'DiscountCodesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /discount-codes
    'DiscountCodesController.validate': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /discount-codes/validate
    'DiscountCodesController.recordUsage': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /discount-codes/:code/use
    'DiscountCodesController.toggle': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /discount-codes/:id/toggle
    'DiscountCodesController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /discount-codes/:id
    'ExpensesController.listCategories': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /expenses/categories
    'ExpensesController.createCategory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /expenses/categories
    'ExpensesController.updateCategory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /expenses/categories/:id
    'ExpensesController.deleteCategory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /expenses/categories/:id
    'ExpensesController.listEntries': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /expenses/entries
    'ExpensesController.createEntry': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /expenses/entries
    'ExpensesController.updateEntry': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /expenses/entries/:id
    'ExpensesController.deleteEntry': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /expenses/entries/:id
    'ExpensesController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /expenses/summary
    'TenantExternalSyncController.getMatchCandidates': "permission is enforced in the service layer, not by a decorator", // GET /tenants/external-sync/match-candidates
    'TenantExternalSyncController.applyMatchDecisions': "permission is enforced in the service layer, not by a decorator", // POST /tenants/external-sync/match-decisions
    'TenantExternalSyncController.listProviders': "permission is enforced in the service layer, not by a decorator", // GET /tenants/external-sync/providers
    'TenantExternalSyncController.getConnection': "permission is enforced in the service layer, not by a decorator", // GET /tenants/external-sync
    'TenantExternalSyncController.upsertConnection': "permission is enforced in the service layer, not by a decorator", // PUT /tenants/external-sync
    'TenantExternalSyncController.deleteConnection': "permission is enforced in the service layer, not by a decorator", // DELETE /tenants/external-sync
    'TenantExternalSyncController.testConnection': "permission is enforced in the service layer, not by a decorator", // POST /tenants/external-sync/test
    'TenantExternalSyncController.startRun': "permission is enforced in the service layer, not by a decorator", // POST /tenants/external-sync/runs
    'TenantExternalSyncController.listRuns': "permission is enforced in the service layer, not by a decorator", // GET /tenants/external-sync/runs
    'TenantExternalSyncController.cancelRun': "permission is enforced in the service layer, not by a decorator", // POST /tenants/external-sync/runs/:runId/cancel
    'FeedbackController.create': "any member may submit feedback", // POST /feedback
    'FundTransfersController.initiate': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /fund-transfers
    'FundTransfersController.receive': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /fund-transfers/:id/receive
    'FundTransfersController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /fund-transfers
    'FundTransfersController.get': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /fund-transfers/:id
    'InventoryDashboardController.getOverview': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/dashboard/overview
    'InventoryDashboardController.getTrends': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/dashboard/trends
    'InventoryReportsController.getReorderSuggestions': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/reorder-suggestions
    'InventoryReportsController.getInventoryValuation': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/valuation
    'InventoryReportsController.getStockOnHand': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/stock-on-hand
    'InventoryReportsController.getStockAging': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/stock-aging
    'InventoryReportsController.getShrinkageSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/shrinkage-summary
    'InventoryReportsController.getProductTransactionHistory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-reports/product-transaction-history
    'InventoryShrinkageController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /inventory-shrinkage
    'InventoryShrinkageController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-shrinkage
    'InventoryShrinkageController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory-shrinkage/:id
    'InventoryController.getWarehouses': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/warehouses
    'InventoryController.createWarehouse': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /inventory/warehouses
    'InventoryController.importWarehouses': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /inventory/warehouses/import
    'InventoryController.updateWarehouse': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /inventory/warehouses/:id
    'InventoryController.getSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/settings
    'InventoryController.updateSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /inventory/settings
    'InventoryController.listReasons': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/reasons
    'InventoryController.createReason': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /inventory/reasons
    'InventoryController.updateReason': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /inventory/reasons/:id
    'InventoryController.getLedger': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /inventory/ledger
    'InvitationsController.listMembers': "permission is enforced in the service layer, not by a decorator", // GET /invitations/members
    'InvitationsController.listPending': "permission is enforced in the service layer, not by a decorator", // GET /invitations/pending
    'InvitationsController.updateMemberRole': "permission is enforced in the service layer, not by a decorator", // PATCH /invitations/members/:userId/role
    'InvitationsController.invite': "permission is enforced in the service layer, not by a decorator", // POST /invitations/send
    'InvitationsController.cancel': "permission is enforced in the service layer, not by a decorator", // DELETE /invitations/:id
    'InvitationsController.accept': "permission is enforced in the service layer, not by a decorator", // POST /invitations/accept
    'LoansController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loans
    'LoansController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loans/summary
    'LoansController.get': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loans/:id
    'LoansController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /loans
    'LoansController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /loans/:id
    'LoansController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /loans/:id
    'LoansController.addPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /loans/:id/payments
    'LoansController.deletePayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /loans/:id/payments/:paymentId
    'LoyaltyController.getSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loyalty/settings
    'LoyaltyController.updateSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /loyalty/settings
    'LoyaltyController.listCustomers': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loyalty/customers
    'LoyaltyController.getCustomerPoints': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /loyalty/customers/:customerId/points
    'LoyaltyController.earnPoints': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /loyalty/customers/:customerId/earn
    'LoyaltyController.redeemPoints': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /loyalty/customers/:customerId/redeem
    'LoyaltyController.adjustPoints': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /loyalty/customers/:customerId/adjust
    'ManufacturingController.listBoms': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/bom
    'ManufacturingController.getBom': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/bom/:id
    'ManufacturingController.getRequirements': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/bom/:id/requirements
    'ManufacturingController.createBom': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/bom
    'ManufacturingController.updateBom': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /manufacturing/bom/:id
    'ManufacturingController.deleteBom': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /manufacturing/bom/:id
    'ManufacturingController.listJobs': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/jobs
    'ManufacturingController.getJob': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/jobs/:id
    'ManufacturingController.createJob': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs
    'ManufacturingController.startJob': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs/:id/start
    'ManufacturingController.completeJob': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs/:id/complete
    'ManufacturingController.cancelJob': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs/:id/cancel
    'ManufacturingController.listCostSources': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/cost-sources
    'ManufacturingController.listJobCosts': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/jobs/:id/costs
    'ManufacturingController.addJobCost': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs/:id/costs
    'ManufacturingController.removeJobCost': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /manufacturing/jobs/:id/costs/:costId
    'ManufacturingController.getPricingSuggestion': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/jobs/:id/pricing-suggestion
    'ManufacturingController.applySuggestedPrice': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /manufacturing/jobs/:id/apply-price
    'ManufacturingController.getAnalytics': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/analytics
    'ManufacturingController.getProductPL': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /manufacturing/reports/product-pl
    'MushakController.getForms': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /mushak/forms
    'MushakController.getTaxInvoice': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /mushak/6.3/:saleId
    'MushakController.getCreditNote': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /mushak/6.7/:returnId
    'NavigationController.getLayout': "shell read: the sidebar layout every member needs to render the app", // GET /navigation/layout
    'NotificationsController.list': "self-scoped: acts only on the signed-in member’s own data", // GET /notifications
    'NotificationsController.unreadCount': "self-scoped: acts only on the signed-in member’s own data", // GET /notifications/unread-count
    'NotificationsController.markAllRead': "self-scoped: acts only on the signed-in member’s own data", // PATCH /notifications/read-all
    'NotificationsController.markRead': "self-scoped: acts only on the signed-in member’s own data", // PATCH /notifications/:id/read
    'PaymentMethodsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /payment-methods
    'PaymentMethodsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /payment-methods/import
    'PaymentMethodsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /payment-methods
    'PaymentMethodsController.findLinkableAccounts': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /payment-methods/accounts
    'PaymentMethodsController.getDefault': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /payment-methods/default/:type
    'PaymentMethodsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /payment-methods/:id
    'PaymentMethodsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /payment-methods/:id
    'PaymentMethodsController.delete': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /payment-methods/:id
    'PriceListsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /price-lists
    'PriceListsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /price-lists/import
    'PriceListsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /price-lists
    'PriceListsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /price-lists/:id
    'PriceListsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /price-lists/:id
    'PriceListsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /price-lists/:id
    'PriceListsController.listItems': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /price-lists/:id/items
    'PriceListsController.updateItem': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /price-lists/:id/items/:productId
    'PriceListsController.bulkUpdateItems': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PUT /price-lists/:id/items/bulk
    'PriceListsController.syncProducts': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /price-lists/:id/sync
    'PrintTemplatesController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /print-templates
    'PrintTemplatesController.resolve': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /print-templates/resolve
    'PrintTemplatesController.get': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /print-templates/:id
    'PrintTemplatesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /print-templates
    'PrintTemplatesController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /print-templates/:id
    'PrintTemplatesController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /print-templates/:id
    'ProductGroupsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /product-groups
    'ProductGroupsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /product-groups/import
    'ProductGroupsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /product-groups
    'ProductGroupsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /product-groups/:id
    'ProductGroupsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /product-groups/:id
    'ProductGroupsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /product-groups/:id
    'ProductSubgroupsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /product-subgroups
    'ProductSubgroupsController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /product-subgroups/import
    'ProductSubgroupsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /product-subgroups
    'ProductSubgroupsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /product-subgroups/:id
    'ProductSubgroupsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /product-subgroups/:id
    'ProductSubgroupsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /product-subgroups/:id
    'ProductsController.importCsv': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /products/import
    'ProductsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /products
    'ProductsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /products
    'ProductsController.searchByQuantity': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /products/search/by-quantity
    'ProductsController.countLowStock': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /products/low-stock-count
    'ProductsController.rateHistory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /products/:id/rate-history
    'ProductsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /products/:id
    'ProductsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /products/:id
    'ProductsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /products/:id
    'PurchaseDashboardController.getOverview': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchases/dashboard/overview
    'PurchaseDashboardController.getTrends': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchases/dashboard/trends
    'PurchaseOrdersController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /purchase-orders
    'PurchaseOrdersController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-orders
    'PurchaseOrdersController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-orders/:id
    'PurchaseOrdersController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /purchase-orders/:id/status
    'PurchaseOrdersController.getInvoice': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-orders/:id/invoice
    'PurchaseQuotationsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /purchase-quotations
    'PurchaseQuotationsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-quotations
    'PurchaseQuotationsController.convertToPurchaseOrder': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /purchase-quotations/:id/convert
    'PurchaseQuotationsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-quotations/:id
    'PurchaseQuotationsController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /purchase-quotations/:id/status
    'PurchaseQuotationsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /purchase-quotations/:id
    'PurchaseReportsController.getPurchaseSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-reports/summary
    'PurchaseReportsController.getPurchaseTrend': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-reports/trend
    'PurchaseReportsController.getPurchasesByProduct': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-reports/by-product
    'PurchaseReportsController.getPurchasesBySupplier': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-reports/by-supplier
    'PurchaseReportsController.getPurchaseLineItems': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-reports/line-items
    'PurchaseReturnsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /purchase-returns
    'PurchaseReturnsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-returns
    'PurchaseReturnsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchase-returns/:id
    'PurchaseReturnsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /purchase-returns/:id
    'PurchaseReturnsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /purchase-returns/:id
    'PurchasesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /purchases
    'PurchasesController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchases
    'PurchasesController.getInvoice': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchases/:id/invoice
    'PurchasesController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /purchases/:id
    'SalaryPaymentsController.list': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /salary-payments
    'SalaryPaymentsController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /salary-payments/summary
    'SalaryPaymentsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /salary-payments/:id
    'SalaryPaymentsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /salary-payments
    'SalaryPaymentsController.runAccrual': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /salary-payments/run-accrual
    'SalaryPaymentsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /salary-payments/:id
    'SalaryPaymentsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /salary-payments/:id
    'SalesDashboardController.getOverview': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales/dashboard/overview
    'SalesDashboardController.getTrends': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales/dashboard/trends
    'SalesOrdersController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-orders
    'SalesOrdersController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-orders
    'SalesOrdersController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-orders/:id
    'SalesOrdersController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-orders/:id
    'SalesOrdersController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-orders/:id/status
    'SalesOrdersController.addDeposit': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-orders/:id/deposits
    'SalesOrdersController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /sales-orders/:id
    'SalesQuotationsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-quotations
    'SalesQuotationsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-quotations
    'SalesQuotationsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-quotations/:id
    'SalesQuotationsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-quotations/:id
    'SalesQuotationsController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-quotations/:id/status
    'SalesQuotationsController.revise': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-quotations/:id/revise
    'SalesQuotationsController.convertToOrder': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-quotations/:id/convert
    'SalesQuotationsController.share': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-quotations/:id/share
    'SalesQuotationsController.revokeShare': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /sales-quotations/:id/share
    'SalesQuotationsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /sales-quotations/:id
    'SalesReportsController.getSalesSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/summary
    'SalesReportsController.getSalesByProduct': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/by-product
    'SalesReportsController.getSalesByCategory': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/by-category
    'SalesReportsController.getSalesByCustomer': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/by-customer
    'SalesReportsController.getSalesLineItems': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/line-items
    'SalesReportsController.getMonthlySalesByCustomer': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/monthly-by-customer
    'SalesReportsController.getSalesTrend': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/trend
    'SalesReportsController.getSalesBreakdown': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-reports/breakdown
    'SalesReturnsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales-returns
    'SalesReturnsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-returns
    'SalesReturnsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-returns/:id
    'SalesReturnsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-returns/:id
    'SalesReturnsController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /sales-returns/:id
    'SalesSettingsController.get': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales-settings
    'SalesSettingsController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales-settings
    'SalesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales
    'SalesController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales
    'SalesController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales/:id
    'SalesController.getInvoice': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sales/:id/invoice
    'SalesController.finalize': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sales/:id/finalize
    'SalesController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /sales/:id
    'SalesController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /sales/:id
    'SmsCreditController.getSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /sms-credits/summary
    'SmsCreditController.createPurchase': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sms-credits/purchase
    'SmsCreditController.confirmPurchase': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /sms-credits/confirm
    'StockTakesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /stock-takes
    'StockTakesController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /stock-takes
    'StockTakesController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /stock-takes/:id
    'StockTakesController.updateCounts': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /stock-takes/:id/counts
    'StockTakesController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /stock-takes/:id/status
    'StockTakesController.post': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /stock-takes/:id/post
    'StorefrontController.getOrders': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /storefront/orders
    'StorefrontController.updateOrderStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /storefront/orders/:id/status
    'SuppliersController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /suppliers
    'SuppliersController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /suppliers/import
    'SuppliersController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers
    'SuppliersController.listCreditPayments': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/credit/payments
    'SuppliersController.getCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/credit/payments/:paymentId
    'SuppliersController.updateCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /suppliers/credit/payments/:paymentId
    'SuppliersController.deleteCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /suppliers/credit/payments/:paymentId
    'SuppliersController.allocatePayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /suppliers/credit/payments/:paymentId/allocate
    'SuppliersController.removeAllocation': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /suppliers/credit/allocations/:allocationId
    'SuppliersController.getBillingSummary': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/:id/billing-summary
    'SuppliersController.getCreditLedger': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/:id/credit
    'SuppliersController.getGlLedger': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/:id/gl-ledger
    'SuppliersController.recordCreditPayment': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /suppliers/:id/credit/payment
    'SuppliersController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /suppliers/:id
    'SuppliersController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /suppliers/:id
    'SuppliersController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /suppliers/:id
    'SupportController.listThreads': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /support/threads
    'SupportController.stream': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /support/stream
    'SupportController.createThread': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /support/threads
    'SupportController.getMessages': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /support/threads/:id/messages
    'SupportController.sendMessage': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /support/threads/:id/messages
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
    'TenantsController.getStorefrontSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/storefront-settings
    'TenantsController.updateStorefrontSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/storefront-settings
    'TenantsController.uploadStorefrontImage': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /tenants/storefront-image
    'TenantsController.getBranding': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/branding
    'TenantsController.updateBranding': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/branding
    'TenantsController.getTaxSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/tax-settings
    'TenantsController.updateTaxSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/tax-settings
    'TenantsController.getSmsSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/sms-settings
    'TenantsController.updateSmsSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/sms-settings
    'TenantsController.getReportSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/report-settings
    'TenantsController.updateReportSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/report-settings
    'TenantsController.getLocalizationSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/localization-settings
    'TenantsController.updateLocalizationSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/localization-settings
    'TenantsController.getDashboardSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/dashboard-settings
    'TenantsController.updateDashboardSettings': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/dashboard-settings
    'TenantsController.getPasswordPolicy': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /tenants/password-policy
    'TenantsController.updatePasswordPolicy': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /tenants/password-policy
    'TenantsController.clearData': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /tenants/data
    'TerritoriesController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /territories
    'TerritoriesController.importRows': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /territories/import
    'TerritoriesController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /territories
    'TerritoriesController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /territories/:id
    'TerritoriesController.update': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /territories/:id
    'TerritoriesController.remove': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // DELETE /territories/:id
    'WarrantyClaimsController.lookup': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /warranty-claims/lookup
    'WarrantyClaimsController.create': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // POST /warranty-claims
    'WarrantyClaimsController.findAll': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /warranty-claims
    'WarrantyClaimsController.findOne': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // GET /warranty-claims/:id
    'WarrantyClaimsController.updateStatus': "TODO(api-audit 2026-09-29): no permission declared — see TODO.md", // PATCH /warranty-claims/:id/status
};
