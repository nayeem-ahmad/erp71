import 'package:flutter/material.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/format/format.dart';
import '../../../ui/launch.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';

/// What to tell the user about a failed load.
String describeError(Object? error) =>
    error is ApiException ? error.message : 'Something went wrong. Try again.';

/// A list that loads page by page as it scrolls, refreshes on pull, and shows
/// loading, empty and failed states in one consistent way.
class PagedListView<T> extends StatelessWidget {
  const PagedListView({
    super.key,
    required this.state,
    required this.onRefresh,
    required this.onLoadMore,
    required this.itemBuilder,
    required this.empty,
  });

  final PagedState<T> state;
  final Future<void> Function() onRefresh;
  final VoidCallback onLoadMore;
  final Widget Function(BuildContext context, T item) itemBuilder;
  final Widget empty;

  @override
  Widget build(BuildContext context) {
    if (state.loading) return const LoadingView();
    if (state.items.isEmpty && state.error != null) {
      return ErrorView(message: describeError(state.error), onRetry: onRefresh);
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: state.items.isEmpty
          // Scrollable, or pull-to-refresh could not reach an empty list.
          ? LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: SizedBox(height: constraints.maxHeight, child: empty),
              ),
            )
          : NotificationListener<ScrollNotification>(
              onNotification: (notification) {
                if (notification.metrics.extentAfter < 400) onLoadMore();
                return false;
              },
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 24),
                itemCount: state.items.length + 1,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  if (index < state.items.length) {
                    return itemBuilder(context, state.items[index]);
                  }
                  return _Footer(state: state, onRetry: onLoadMore);
                },
              ),
            ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.state, required this.onRetry});

  final PagedState<dynamic> state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (state.loadingMore) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(
          child: SizedBox.square(
            dimension: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (state.error != null) {
      return Padding(
        padding: const EdgeInsets.all(8),
        child: Center(
          child: TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: Text(describeError(state.error)),
          ),
        ),
      );
    }
    if (!state.hasMore && state.total > 0) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: Text(
            state.total == 1
                ? '1 record'
                : '${formatCount(state.total)} records',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

/// A search box that reports what was typed once the user pauses.
class SearchField extends StatefulWidget {
  const SearchField({
    super.key,
    required this.hint,
    required this.initial,
    required this.onChanged,
  });

  final String hint;
  final String initial;
  final ValueChanged<String> onChanged;

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  late final _controller = TextEditingController(text: widget.initial);
  Future<void>? _pending;
  String _lastSent = '';

  @override
  void initState() {
    super.initState();
    _lastSent = widget.initial;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _changed(String value) {
    setState(() {});
    final scheduled = Future<void>.delayed(const Duration(milliseconds: 400));
    _pending = scheduled;
    scheduled.then((_) {
      // Only the latest keystroke's timer fires the search.
      if (!mounted || _pending != scheduled || value == _lastSent) return;
      _lastSent = value;
      widget.onChanged(value);
    });
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      onChanged: _changed,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: widget.hint,
        prefixIcon: const Icon(Icons.search, size: 20),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear',
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _controller.clear();
                  _changed('');
                },
              ),
      ),
    );
  }
}

class LeadTile extends StatelessWidget {
  const LeadTile({super.key, required this.lead, required this.onTap});

  final Lead lead;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final overdue =
        lead.nextStepDate != null &&
        lead.status.isOpen &&
        calendarDaysBetween(
              workspaceNow(),
              inWorkspaceZone(lead.nextStepDate!),
            ) <
            0;
    final meta = [
      lead.source?.name,
      lead.assignee?.displayName,
    ].whereType<String>().join(' · ');

    return ListTile(
      onTap: onTap,
      title: Row(
        children: [
          Expanded(
            child: Text(
              lead.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          StatusBadge(lead.status.label, tone: lead.status.tone),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          if (lead.nextStep != null)
            Text(
              [
                lead.nextStep!,
                if (lead.nextStepDate != null)
                  formatDueLabel(lead.nextStepDate),
              ].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: overdue ? AppColors.danger : AppColors.textSecondary,
                fontWeight: overdue ? FontWeight.w600 : FontWeight.normal,
              ),
            )
          else if (lead.mobile != null)
            Text(lead.mobile!),
          if (meta.isNotEmpty || lead.status.isOpen)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  if (lead.status.isOpen) ...[
                    StatusBadge(
                      'Score ${lead.score}',
                      tone: scoreTone(lead.score),
                    ),
                    const SizedBox(width: 6),
                  ],
                  if (lead.priority == LeadPriority.high ||
                      lead.priority == LeadPriority.urgent) ...[
                    StatusBadge(lead.priority.label, tone: lead.priority.tone),
                    const SizedBox(width: 6),
                  ],
                  Expanded(
                    child: Text(
                      meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class ContactTile extends StatelessWidget {
  const ContactTile({super.key, required this.contact, required this.onTap});

  final Contact contact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final lines = [
      contact.roleLine,
      contact.mobile ?? contact.phone ?? contact.email,
    ].whereType<String>().toList();
    return ListTile(
      onTap: onTap,
      leading: InitialsAvatar(initialsOf(contact.name)),
      title: Text(contact.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: lines.isEmpty
          ? null
          : Text(
              lines.join('\n'),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
    );
  }
}

class ActivityTile extends StatelessWidget {
  const ActivityTile({
    super.key,
    required this.activity,
    required this.onTap,
    this.showTarget = true,
  });

  final Activity activity;
  final VoidCallback onTap;

  /// Off inside a lead's own timeline, where the lead is already on screen.
  final bool showTarget;

  @override
  Widget build(BuildContext context) {
    final overdue = activity.isOverdue();
    final when = switch (activity.status) {
      ActivityStatus.planned =>
        activity.dueAt == null ? 'No due date' : formatDueLabel(activity.dueAt),
      ActivityStatus.done => 'Done ${formatAgo(activity.completedAt)}',
      ActivityStatus.cancelled => 'Cancelled',
    };
    final meta = [
      if (showTarget) activity.targetName,
      activity.channel?.name ?? activity.purpose?.name,
      activity.assignee?.displayName,
    ].whereType<String>().join(' · ');

    return ListTile(
      onTap: onTap,
      leading: _ActivityIcon(activity: activity),
      title: Text(
        activity.title,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: activity.status == ActivityStatus.cancelled
            ? const TextStyle(
                decoration: TextDecoration.lineThrough,
                color: AppColors.textSecondary,
              )
            : null,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            when,
            style: TextStyle(
              color: overdue ? AppColors.danger : AppColors.textSecondary,
              fontWeight: overdue ? FontWeight.w600 : FontWeight.normal,
            ),
          ),
          if (meta.isNotEmpty)
            Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis),
          if (activity.status == ActivityStatus.done &&
              activity.subject != null &&
              activity.summary != null)
            Text(
              activity.summary!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }
}

class _ActivityIcon extends StatelessWidget {
  const _ActivityIcon({required this.activity});

  final Activity activity;

  @override
  Widget build(BuildContext context) {
    final emoji = activity.channel?.icon ?? activity.purpose?.icon;
    final (
      Color background,
      Color foreground,
      IconData icon,
    ) = switch (activity.status) {
      ActivityStatus.done => (
        AppColors.successTint,
        AppColors.success,
        Icons.check,
      ),
      ActivityStatus.cancelled => (
        AppColors.neutralTint,
        AppColors.textHint,
        Icons.close,
      ),
      ActivityStatus.planned when activity.isOverdue() => (
        AppColors.dangerTint,
        AppColors.danger,
        Icons.schedule,
      ),
      ActivityStatus.planned => (
        AppColors.primaryTint,
        AppColors.primary,
        Icons.schedule,
      ),
    };
    return CircleAvatar(
      radius: 18,
      backgroundColor: background,
      child: emoji != null && emoji.isNotEmpty
          ? Text(emoji, style: const TextStyle(fontSize: 16))
          : Icon(icon, size: 18, color: foreground),
    );
  }
}

/// Call / text / WhatsApp / email buttons for whatever the record has.
class ReachOutBar extends StatelessWidget {
  const ReachOutBar({super.key, this.mobile, this.email});

  final String? mobile;
  final String? email;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _ReachButton(
          icon: Icons.call_outlined,
          label: 'Call',
          onPressed: mobile == null ? null : () => callNumber(mobile!),
        ),
        _ReachButton(
          icon: Icons.sms_outlined,
          label: 'SMS',
          onPressed: mobile == null ? null : () => textNumber(mobile!),
        ),
        _ReachButton(
          icon: Icons.chat_outlined,
          label: 'WhatsApp',
          onPressed: mobile == null ? null : () => whatsAppNumber(mobile!),
        ),
        _ReachButton(
          icon: Icons.mail_outline,
          label: 'Email',
          onPressed: email == null ? null : () => emailAddress(email!),
        ),
      ],
    );
  }
}

class _ReachButton extends StatelessWidget {
  const _ReachButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final color = onPressed == null ? AppColors.textHint : AppColors.primary;
    return Expanded(
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: color,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
