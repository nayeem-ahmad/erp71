import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format/format.dart';
import '../../core/providers.dart';

/// The kinds the inbox gathers, as GET /approvals/inbox names them.
enum ApprovalKind {
  expenseClaim('EXPENSE_CLAIM', 'Expense claim', 'Expense claims'),
  leaveRequest('LEAVE_REQUEST', 'Leave request', 'Leave'),
  productDemand('PRODUCT_DEMAND', 'Product demand', 'Demands'),
  warehouseTransfer('WAREHOUSE_TRANSFER', 'Stock transfer', 'Transfers'),
  voucher('VOUCHER', 'Voucher', 'Vouchers');

  const ApprovalKind(this.code, this.label, this.plural);

  final String code;
  final String label;
  final String plural;

  static ApprovalKind? parse(Object? code) {
    for (final kind in values) {
      if (kind.code == code) return kind;
    }
    return null;
  }
}

class ApprovalItem {
  const ApprovalItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.details,
    this.amount,
    this.requestedBy,
    this.requestedAt,
    this.branch,
  });

  static ApprovalItem? fromJson(Map<String, dynamic> json) {
    final kind = ApprovalKind.parse(json['kind']);
    final id = json['id'];
    if (kind == null || id is! String) return null;
    return ApprovalItem(
      kind: kind,
      id: id,
      title: json['title'] as String? ?? kind.label,
      amount: parseDecimal(json['amount']),
      requestedBy: json['requested_by'] as String?,
      requestedAt: parseInstant(json['requested_at']),
      branch: json['branch'] as String?,
      details: [
        for (final row in (json['details'] as List<dynamic>? ?? const []))
          if (row is Map<String, dynamic>)
            (
              label: row['label'] as String? ?? '',
              value: row['value'] as String? ?? '',
            ),
      ],
    );
  }

  final ApprovalKind kind;
  final String id;
  final String title;
  final double? amount;
  final String? requestedBy;
  final DateTime? requestedAt;
  final String? branch;
  final List<({String label, String value})> details;
}

class ApprovalInbox {
  const ApprovalInbox({required this.items, required this.kinds});

  factory ApprovalInbox.fromJson(Map<String, dynamic> json) => ApprovalInbox(
    items: [
      for (final row in (json['items'] as List<dynamic>? ?? const []))
        if (row is Map<String, dynamic>) ?ApprovalItem.fromJson(row),
    ],
    kinds: [
      for (final code in (json['kinds'] as List<dynamic>? ?? const []))
        ?ApprovalKind.parse(code),
    ],
  );

  final List<ApprovalItem> items;

  /// The kinds this member may decide, whether or not any are waiting.
  final List<ApprovalKind> kinds;

  int get total => items.length;

  ApprovalInbox without(ApprovalItem item) => ApprovalInbox(
    items: [
      for (final i in items)
        if (!(i.kind == item.kind && i.id == item.id)) i,
    ],
    kinds: kinds,
  );
}

class ApprovalsRepository {
  ApprovalsRepository(this._api);

  final ApiClient _api;

  Future<ApprovalInbox> inbox() async => ApprovalInbox.fromJson(
    await _api.get('/approvals/inbox') as Map<String, dynamic>,
  );

  Future<void> approve(ApprovalItem item, {String? note}) => _api.post(
    '/approvals/${item.kind.code}/${item.id}/approve',
    body: {if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
  );

  Future<void> reject(ApprovalItem item, {required String reason}) => _api.post(
    '/approvals/${item.kind.code}/${item.id}/reject',
    body: {'reason': reason.trim()},
  );
}

final approvalsRepositoryProvider = Provider<ApprovalsRepository>(
  (ref) => ApprovalsRepository(ref.watch(apiClientProvider)),
);

/// Shared by the Approvals tab and its badge, per workspace and branch.
final approvalsInboxProvider = FutureProvider.autoDispose<ApprovalInbox>((ref) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));
  ref.watch(activeBranchProvider.select((b) => b?.id));
  return ref.watch(approvalsRepositoryProvider).inbox();
});

/// Approving at or above this many taka asks for the phone's own lock first,
/// so an unlocked phone left on a counter cannot sign off a large payment.
const double confirmApprovalAbove = 50000;
