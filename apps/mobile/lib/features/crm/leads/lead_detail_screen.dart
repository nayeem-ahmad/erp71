import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/format/format.dart';
import '../../../ui/launch.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../access.dart';
import '../activities/activity_sheets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// One lead: who they are, what happens next, what has happened, and the
/// buttons to move it along.
class LeadDetailScreen extends ConsumerWidget {
  const LeadDetailScreen({super.key, required this.leadId});

  final String leadId;

  Future<void> _delete(BuildContext context, WidgetRef ref, Lead lead) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete ${lead.name}?'),
        content: const Text(
          'Its activities are deleted with it. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(crmRepositoryProvider).deleteLead(lead.id);
      ref.refreshLeadViews();
      if (context.mounted) context.pop();
      showToast('Lead deleted', tone: Tone.success);
    } on ApiException catch (e) {
      showToast(e.message, tone: Tone.danger);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lead = ref.watch(leadProvider(leadId));
    final loaded = lead.value;

    return Scaffold(
      appBar: AppBar(
        title: Text(loaded?.name ?? 'Lead'),
        actions: [
          if (loaded != null && !loaded.isConverted)
            IconButton(
              tooltip: 'Edit',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => context.push('/leads/$leadId/edit'),
            ),
          if (loaded != null)
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'delete') _delete(context, ref, loaded);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'delete',
                  child: Text(
                    'Delete lead',
                    style: TextStyle(color: AppColors.danger),
                  ),
                ),
              ],
            ),
        ],
      ),
      body: lead.when(
        skipLoadingOnRefresh: true,
        loading: () => const LoadingView(),
        error: (error, _) => ErrorView(
          message: describeError(error),
          onRetry: () => ref.invalidate(leadProvider(leadId)),
        ),
        data: (lead) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(leadActivitiesProvider(leadId));
            return ref.refresh(leadProvider(leadId).future);
          },
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              _IdentityCard(lead: lead),
              const SizedBox(height: 12),
              _NextStepCard(lead: lead),
              _ActionButtons(lead: lead),
              const SizedBox(height: 12),
              _DetailsCard(lead: lead),
              if (ref.can(CrmPermission.viewActivities)) ...[
                const SizedBox(height: 12),
                _Timeline(leadId: lead.id),
              ],
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

class _IdentityCard extends StatelessWidget {
  const _IdentityCard({required this.lead});

  final Lead lead;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final origin = [
      lead.source?.name,
      lead.category?.name,
    ].whereType<String>().join(' · ');
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              InitialsAvatar(initialsOf(lead.name), size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      lead.name,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontSize: 16,
                      ),
                    ),
                    if (origin.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(origin, style: theme.textTheme.bodySmall),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusBadge(lead.status.label, tone: lead.status.tone),
              StatusBadge(
                '${lead.priority.label} priority',
                tone: lead.priority.tone,
              ),
              if (lead.status.isOpen)
                StatusBadge('Score ${lead.score}', tone: scoreTone(lead.score)),
            ],
          ),
          if (lead.status == LeadStatus.lost && lead.lostReason != null) ...[
            const SizedBox(height: 10),
            InlineNotice(
              message: 'Lost: ${lead.lostReason}',
              tone: Tone.danger,
            ),
          ],
          if (lead.isConverted) ...[
            const SizedBox(height: 10),
            InlineNotice(
              tone: Tone.success,
              message: lead.convertedCustomerName == null
                  ? 'Converted. Converted leads can no longer be edited.'
                  : 'Converted to customer ${lead.convertedCustomerName}.',
            ),
          ],
          const Divider(height: 24),
          ReachOutBar(mobile: lead.mobile, email: lead.email),
        ],
      ),
    );
  }
}

class _NextStepCard extends ConsumerWidget {
  const _NextStepCard({required this.lead});

  final Lead lead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!lead.status.isOpen || lead.nextStep == null) {
      return const SizedBox.shrink();
    }
    final due = lead.nextStepDate;
    final overdue =
        due != null &&
        calendarDaysBetween(workspaceNow(), inWorkspaceZone(due)) < 0;
    final nextId = lead.nextActivityId;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SectionCard(
        title: 'Next step',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(lead.nextStep!, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 4),
            Text(
              [
                if (due != null) formatDueLabel(due) else 'No due date',
                ?lead.nextStepAssignee?.displayName,
              ].join(' · '),
              style: TextStyle(
                fontSize: 12,
                color: overdue ? AppColors.danger : AppColors.textSecondary,
                fontWeight: overdue ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
            if (nextId != null &&
                ref.can(CrmPermission.completeActivities)) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => showCompleteActivitySheet(
                  context,
                  Activity(
                    id: nextId,
                    status: ActivityStatus.planned,
                    subject: lead.nextStep,
                    dueAt: due,
                    leadId: lead.id,
                    leadName: lead.name,
                    leadMobile: lead.mobile,
                  ),
                ),
                icon: const Icon(Icons.check, size: 18),
                label: const Text('Mark as done'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ActionButtons extends ConsumerWidget {
  const _ActionButtons({required this.lead});

  final Lead lead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Activities cannot be added to a lost or converted lead.
    final canWork =
        lead.status.isOpen && ref.can(CrmPermission.manageActivities);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (canWork)
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () =>
                      showLogActivitySheet(context, leadId: lead.id),
                  icon: const Icon(Icons.edit_note, size: 18),
                  label: const Text('Log activity'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () =>
                      showPlanFollowUpSheet(context, leadId: lead.id),
                  icon: const Icon(Icons.event_outlined, size: 18),
                  label: const Text('Plan follow-up'),
                ),
              ),
            ],
          ),
        if (!lead.isConverted) ...[
          if (canWork) const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _showStatusSheet(context, lead),
            icon: const Icon(Icons.swap_horiz, size: 18),
            label: const Text('Change status'),
          ),
        ],
      ],
    );
  }
}

Future<void> _showStatusSheet(BuildContext context, Lead lead) =>
    showAppSheet<void>(
      context: context,
      title: 'Change status',
      builder: (_) => _StatusOptions(lead: lead),
    );

class _StatusOptions extends ConsumerStatefulWidget {
  const _StatusOptions({required this.lead});

  final Lead lead;

  @override
  ConsumerState<_StatusOptions> createState() => _StatusOptionsState();
}

class _StatusOptionsState extends ConsumerState<_StatusOptions> {
  bool _busy = false;

  Future<void> _apply(Future<void> Function() change, String done) async {
    setState(() => _busy = true);
    try {
      await change();
      ref.refreshLeadViews(widget.lead.id);
      if (mounted) Navigator.of(context).pop();
      showToast(done, tone: Tone.success);
    } on ApiException catch (e) {
      showToast(e.message, tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _markLost() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _LostReasonDialog(),
    );
    if (reason == null || !mounted) return;
    await _apply(
      () => ref
          .read(crmRepositoryProvider)
          .setLeadStatus(widget.lead.id, LeadStatus.lost, lostReason: reason),
      'Marked as lost',
    );
  }

  Future<void> _convert() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Convert to customer?'),
        content: const Text(
          'This creates a customer from the lead and closes it as won. '
          'Its planned follow-ups are cancelled, and a converted lead can no '
          'longer be edited.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Not yet'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Convert'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _apply(
      () => ref.read(crmRepositoryProvider).convertLead(widget.lead.id),
      'Converted to a customer',
    );
  }

  @override
  Widget build(BuildContext context) {
    final lead = widget.lead;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final status in LeadStatus.open)
          if (status != lead.status)
            ListTile(
              enabled: !_busy,
              contentPadding: EdgeInsets.zero,
              tileColor: Colors.transparent,
              leading: StatusBadge(status.label, tone: status.tone),
              title: Text(
                lead.status == LeadStatus.lost
                    ? 'Reopen as ${status.label.toLowerCase()}'
                    : 'Move to ${status.label.toLowerCase()}',
              ),
              onTap: () => _apply(
                () => ref
                    .read(crmRepositoryProvider)
                    .setLeadStatus(lead.id, status),
                'Moved to ${status.label}',
              ),
            ),
        if (lead.status != LeadStatus.lost)
          ListTile(
            enabled: !_busy,
            contentPadding: EdgeInsets.zero,
            tileColor: Colors.transparent,
            leading: const Icon(
              Icons.thumb_down_alt_outlined,
              color: AppColors.danger,
            ),
            title: const Text('Mark as lost'),
            subtitle: const Text('Cancels its planned follow-ups'),
            onTap: _markLost,
          ),
        ListTile(
          enabled: !_busy,
          contentPadding: EdgeInsets.zero,
          tileColor: Colors.transparent,
          leading: const Icon(
            Icons.verified_outlined,
            color: AppColors.success,
          ),
          title: const Text('Convert to customer'),
          subtitle: const Text('Closes the lead as won'),
          onTap: _convert,
        ),
      ],
    );
  }
}

class _LostReasonDialog extends StatefulWidget {
  const _LostReasonDialog();

  @override
  State<_LostReasonDialog> createState() => _LostReasonDialogState();
}

class _LostReasonDialogState extends State<_LostReasonDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _reason.text.trim();
    if (reason.isEmpty) {
      setState(
        () => _error = 'Say why, so the pipeline report can learn from it.',
      );
      return;
    }
    Navigator.pop(context, reason);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Why was it lost?'),
      content: TextField(
        controller: _reason,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(
          hintText: 'e.g. Chose a cheaper supplier',
          errorText: _error,
          errorMaxLines: 2,
        ),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(
          style: TextButton.styleFrom(foregroundColor: AppColors.danger),
          onPressed: _submit,
          child: const Text('Mark as lost'),
        ),
      ],
    );
  }
}

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.lead});

  final Lead lead;

  @override
  Widget build(BuildContext context) {
    final links = <(String, String)>[
      if (lead.websiteUrl != null) ('Website', lead.websiteUrl!),
      if (lead.facebookUrl != null) ('Facebook', lead.facebookUrl!),
      if (lead.linkedinUrl != null) ('LinkedIn', lead.linkedinUrl!),
      if (lead.xUrl != null) ('X', lead.xUrl!),
    ];
    return SectionCard(
      title: 'Details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (lead.mobile != null)
            InfoRow(
              label: 'Mobile',
              value: lead.mobile!,
              icon: Icons.call_outlined,
              onTap: () => callNumber(lead.mobile!),
            ),
          if (lead.email != null)
            InfoRow(
              label: 'Email',
              value: lead.email!,
              icon: Icons.mail_outline,
              onTap: () => emailAddress(lead.email!),
            ),
          if (lead.address != null)
            InfoRow(label: 'Address', value: lead.address!),
          InfoRow(
            label: 'Owner',
            value: lead.assignee?.displayName ?? 'Unassigned',
          ),
          if (lead.source != null)
            InfoRow(label: 'Source', value: lead.source!.name),
          if (lead.category != null)
            InfoRow(label: 'Category', value: lead.category!.name),
          if (lead.remarks != null)
            InfoRow(label: 'Remarks', value: lead.remarks!),
          InfoRow(
            label: 'Last contacted',
            value: lead.lastContactedAt == null
                ? 'Never'
                : formatAgo(lead.lastContactedAt),
          ),
          InfoRow(label: 'Added', value: formatDate(lead.createdAt)),
          for (final (label, url) in links)
            InfoRow(
              label: label,
              value: url,
              icon: Icons.open_in_new,
              onTap: () => openLink(url),
            ),
        ],
      ),
    );
  }
}

class _Timeline extends ConsumerWidget {
  const _Timeline({required this.leadId});

  final String leadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activities = ref.watch(leadActivitiesProvider(leadId));
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(
              'Activity',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          activities.when(
            skipLoadingOnRefresh: true,
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Padding(
              padding: const EdgeInsets.all(16),
              child: TextButton.icon(
                onPressed: () => ref.invalidate(leadActivitiesProvider(leadId)),
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(describeError(error)),
              ),
            ),
            data: (list) => list.isEmpty
                ? const Padding(
                    padding: EdgeInsets.fromLTRB(16, 8, 16, 16),
                    child: Text(
                      'Nothing logged yet.',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : Column(
                    children: [
                      for (final activity in list)
                        ActivityTile(
                          activity: activity,
                          showTarget: false,
                          onTap: () => showActivitySheet(
                            context,
                            activity,
                            showLeadLink: false,
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
