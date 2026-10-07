import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/access.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/auth/models.dart';
import '../../../core/providers.dart';
import 'business_repository.dart';
import 'models.dart';

final businessRepositoryProvider = Provider<BusinessRepository>(
  (ref) => BusinessRepository(ref.watch(apiClientProvider)),
);

/// The `storeId` value for every branch at once.
const allBranches = 'all';

/// Owners, and anyone the server lets read `storeId=all`.
bool canSeeAllBranches(Workspace workspace) =>
    workspace.can(AreaPermissions.consolidated);

/// The branches the business screens can be filtered to, `all` first when
/// allowed. One entry means there is nothing to choose.
List<({String id, String name})> branchChoices(Workspace workspace) => [
  if (canSeeAllBranches(workspace) && workspace.branches.length > 1)
    (id: allBranches, name: 'All branches'),
  for (final branch in workspace.branches) (id: branch.id, name: branch.name),
];

/// Which branch Home and Cashiers show, shared so the two tabs agree. Starts
/// on every branch for an owner and on the member's own branch for everyone
/// else, and starts over when the workspace changes.
final businessBranchProvider = NotifierProvider<BusinessBranch, String?>(
  BusinessBranch.new,
);

class BusinessBranch extends Notifier<String?> {
  @override
  String? build() {
    final workspace = ref.watch(activeWorkspaceProvider);
    final branch = ref.watch(activeBranchProvider);
    if (workspace == null) return null;
    final choices = branchChoices(workspace);
    if (choices.any((c) => c.id == allBranches)) return allBranches;
    // A single-branch owner gets that branch, not a one-item "All".
    return branch?.id ?? (choices.isEmpty ? null : choices.first.id);
  }

  void select(String storeId) => state = storeId;
}

void _watchContext(Ref ref) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));
  ref.watch(activeBranchProvider.select((b) => b?.id));
}

final pulseProvider = FutureProvider.autoDispose<Pulse>((ref) {
  _watchContext(ref);
  final storeId = ref.watch(businessBranchProvider);
  return ref.watch(businessRepositoryProvider).pulse(storeId: storeId);
});

final cashierOverviewProvider = FutureProvider.autoDispose<CashierOverview>((
  ref,
) {
  _watchContext(ref);
  final storeId = ref.watch(businessBranchProvider);
  return ref
      .watch(businessRepositoryProvider)
      .cashierOverview(storeId: storeId);
});

final tillSummaryProvider = FutureProvider.autoDispose
    .family<TillSummary, String>((ref, sessionId) {
      _watchContext(ref);
      return ref.watch(businessRepositoryProvider).tillSummary(sessionId);
    });

final cashMovementsProvider = FutureProvider.autoDispose
    .family<List<CashMovement>, String>((ref, sessionId) {
      _watchContext(ref);
      return ref.watch(businessRepositoryProvider).cashMovements(sessionId);
    });
