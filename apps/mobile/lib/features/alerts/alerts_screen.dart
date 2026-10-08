import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/format.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../business/widgets/business_widgets.dart' show TitleWithWorkspace;
import '../crm/widgets/crm_widgets.dart' show PagedListView;
import '../home/home_shell.dart';
import 'alerts_data.dart';

/// The bell, on the phone: every notification for this workspace, unread
/// first. Tapping one marks it read and opens what it is about, when the
/// phone has a screen for that.
class AlertsScreen extends ConsumerWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(alertsProvider);
    final controller = ref.read(alertsProvider.notifier);
    final anyUnread = state.items.any((a) => a.unread);

    return Scaffold(
      appBar: AppBar(
        title: const TitleWithWorkspace('Alerts'),
        actions: [
          if (anyUnread)
            IconButton(
              tooltip: 'Mark all read',
              icon: const Icon(Icons.done_all),
              onPressed: () async {
                try {
                  await controller.markAllRead();
                } catch (error) {
                  showToast(describeError(error), tone: Tone.danger);
                }
              },
            ),
          const AccountButton(),
        ],
      ),
      body: PagedListView<AppNotification>(
        state: state,
        onRefresh: () async {
          ref.invalidate(unreadAlertsProvider);
          await controller.refresh();
        },
        onLoadMore: controller.loadMore,
        empty: const EmptyView(
          icon: Icons.notifications_none,
          title: 'Nothing yet',
          message:
              'Approvals waiting, low stock, short tills and other things '
              'worth knowing about will show up here.',
        ),
        itemBuilder: (context, alert) => _AlertTile(
          alert: alert,
          onTap: () {
            controller.markRead(alert).catchError((_) {});
            final route = mobileRouteFor(alert.link);
            if (route != null) context.go(route);
          },
        ),
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.alert, required this.onTap});

  final AppNotification alert;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (icon, tone) = alertLook(alert.type);
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: kTouchTarget),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: tone.background,
                child: Icon(icon, size: 18, color: tone.foreground),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      alert.title,
                      style: TextStyle(
                        fontWeight: alert.unread
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                    if (alert.body.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        alert.body,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      formatAgo(alert.createdAt),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textHint,
                      ),
                    ),
                  ],
                ),
              ),
              if (alert.unread)
                Semantics(
                  container: true,
                  label: 'Unread',
                  child: Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(left: 8, top: 6),
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// An icon and tone for each kind of notification the backend writes.
(IconData, Tone) alertLook(String type) => switch (type) {
  'LOW_STOCK' => (Icons.inventory_2_outlined, Tone.warning),
  'SUBSCRIPTION_EXPIRY' ||
  'PAYMENT_FAILED' ||
  'BILLING' => (Icons.credit_card_outlined, Tone.warning),
  'APPROVAL_REQUEST' => (Icons.fact_check_outlined, Tone.primary),
  'APPROVAL_DECIDED' => (Icons.task_alt, Tone.success),
  'TILL_SHORTFALL' => (Icons.point_of_sale_outlined, Tone.danger),
  'LARGE_SALE' ||
  'LARGE_REFUND' ||
  'SALE_VOIDED' ||
  'BIG_DISCOUNT' => (Icons.receipt_long_outlined, Tone.warning),
  'ENQUIRY' => (Icons.mark_email_unread_outlined, Tone.primary),
  'ANOMALY_DIGEST' => (Icons.troubleshoot, Tone.warning),
  'ALERT_DIGEST' => (Icons.inbox_outlined, Tone.neutral),
  _ => (Icons.notifications_none, Tone.neutral),
};
