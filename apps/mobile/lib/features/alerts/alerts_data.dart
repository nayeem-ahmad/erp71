import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format/format.dart';
import '../../core/providers.dart';
import '../crm/data/crm_providers.dart' show PagedController, PagedState;
import '../crm/data/crm_repository.dart' show Paged;

/// One row of GET /notifications: the bell's list, the same on web and phone.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    this.link,
    this.readAt,
    this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] as String,
        type: json['type'] as String? ?? 'INFO',
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        link: json['link'] as String?,
        readAt: parseInstant(json['read_at']),
        createdAt: parseInstant(json['created_at']),
      );

  final String id;
  final String type;
  final String title;
  final String body;

  /// A web path, e.g. `/crm/activities?highlight=…`; see [mobileRouteFor].
  final String? link;
  final DateTime? readAt;
  final DateTime? createdAt;

  bool get unread => readAt == null;

  AppNotification markedRead() => AppNotification(
    id: id,
    type: type,
    title: title,
    body: body,
    link: link,
    readAt: readAt ?? DateTime.now(),
    createdAt: createdAt,
  );
}

class AlertsRepository {
  AlertsRepository(this._api);

  final ApiClient _api;

  Future<Paged<AppNotification>> list({int page = 1}) async {
    final result = await _api.getPage(
      '/notifications',
      query: {'page': '$page', 'limit': '20'},
    );
    return Paged(
      [
        for (final row in result.items)
          if (row is Map<String, dynamic>) AppNotification.fromJson(row),
      ],
      total: result.total,
      hasMore: result.hasMore,
    );
  }

  Future<int> unreadCount() async {
    final json = await _api.get('/notifications/unread-count');
    final count = json is Map<String, dynamic> ? json['count'] : null;
    return count is num ? count.toInt() : 0;
  }

  Future<void> markRead(String id) => _api.patch('/notifications/$id/read');

  Future<void> markAllRead() => _api.patch('/notifications/read-all');
}

final alertsRepositoryProvider = Provider<AlertsRepository>(
  (ref) => AlertsRepository(ref.watch(apiClientProvider)),
);

final alertsProvider =
    NotifierProvider.autoDispose<AlertsController, PagedState<AppNotification>>(
      AlertsController.new,
    );

class AlertsController extends PagedController<AppNotification> {
  @override
  Future<Paged<AppNotification>> fetch(int page) =>
      ref.read(alertsRepositoryProvider).list(page: page);

  /// Shown as read at once; the server catches up behind it.
  Future<void> markRead(AppNotification alert) async {
    if (!alert.unread) return;
    state = state.copyWith(
      items: [
        for (final item in state.items)
          item.id == alert.id ? item.markedRead() : item,
      ],
    );
    try {
      await ref.read(alertsRepositoryProvider).markRead(alert.id);
    } finally {
      ref.invalidate(unreadAlertsProvider);
    }
  }

  Future<void> markAllRead() async {
    await ref.read(alertsRepositoryProvider).markAllRead();
    state = state.copyWith(
      items: [for (final item in state.items) item.markedRead()],
    );
    ref.invalidate(unreadAlertsProvider);
  }
}

/// The badge on the Alerts tab, for the active workspace.
final unreadAlertsProvider = FutureProvider.autoDispose<int>((ref) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));
  return ref.watch(alertsRepositoryProvider).unreadCount();
});

/// Where a notification's web link opens on the phone, or null when the
/// phone has no screen for it and the alert itself is the whole message.
/// Only the shape of the path is trusted; anything unrecognised stays put.
String? mobileRouteFor(String? link) {
  if (link == null || link.isEmpty) return null;
  final uri = Uri.tryParse(link);
  if (uri == null || uri.hasScheme) return null;
  final parts = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (parts.isEmpty) return '/home';
  String? id(int index) => parts.length > index ? parts[index] : null;

  switch (parts.first) {
    case 'dashboard':
      return '/home';
    case 'approvals':
      return '/approvals';
    case 'crm':
      final area = id(1);
      final record = id(2);
      return switch (area) {
        'leads' => record == null ? '/leads' : '/leads/$record',
        'contacts' => record == null ? '/contacts' : '/contacts/$record',
        'activities' => '/activities',
        _ => '/crm',
      };
    case 'sales':
      return id(1) == 'cashier-sessions' ? '/cashiers' : null;
  }
  return null;
}
