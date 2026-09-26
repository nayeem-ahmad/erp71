import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/models.dart';

extension CrmAccess on WidgetRef {
  /// Whether the member may do [permission] in the active workspace. Used to
  /// leave out actions the server would refuse, not as the enforcement.
  bool can(String permission) =>
      watch(activeWorkspaceProvider)?.can(permission) ?? false;
}

/// The store permissions the CRM checks (StorePermission in
/// packages/shared-types). Leads and contacts check none: any member of a
/// workspace whose plan includes the CRM may work them.
abstract final class CrmPermission {
  /// The overview dashboard.
  static const viewLeads = 'VIEW_LEADS';

  /// The Activities list and every lead's timeline.
  static const viewActivities = 'VIEW_CRM_INTERACTIONS';

  /// Logging a call or visit, and planning a follow-up.
  static const manageActivities = 'MANAGE_CRM_TASKS';

  /// Marking a planned activity done.
  static const completeActivities = 'CREATE_CRM_INTERACTIONS';
}

/// Whether this workspace can use the CRM at all. Mirrors what every CRM
/// endpoint checks (SubscriptionAccessGuard with `premiumCrm`): the plan
/// includes it and the subscription is active or trialing. The web also
/// hides the CRM on accounting-only plans.
bool canUseCrm(Workspace workspace) =>
    workspace.hasPlanFeature('premiumCrm') &&
    workspace.subscriptionActive &&
    !workspace.hasPlanFeature('accountingOnly');
