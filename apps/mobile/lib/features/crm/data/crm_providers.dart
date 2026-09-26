import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/providers.dart';
import 'crm_repository.dart';
import 'models.dart';

final crmRepositoryProvider = Provider<CrmRepository>(
  (ref) => CrmRepository(ref.watch(apiClientProvider)),
);

/// Rebuilds whatever calls it when the workspace or branch changes: nothing
/// may show one shop's records after switching to another, and what a member
/// may see is decided per branch.
void _watchContext(Ref ref) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));
  ref.watch(activeBranchProvider.select((b) => b?.id));
}

/// "Only mine", shared by every CRM screen as it is on the web. Starts on for
/// staff and off for owners, who usually want the whole shop in view.
final crmMineOnlyProvider = NotifierProvider<MineOnly, bool>(MineOnly.new);

class MineOnly extends Notifier<bool> {
  @override
  bool build() =>
      !(ref.watch(activeWorkspaceProvider.select((w) => w?.isOwner)) ?? false);

  void set(bool value) => state = value;
}

/// Kept for the whole session per workspace: these lists change rarely, and
/// the API allows a phone only 20 requests a minute.
final taxonomyProvider = FutureProvider.family<List<CrmOption>, TaxonomyKind>((
  ref,
  kind,
) {
  _watchContext(ref);
  return ref.watch(crmRepositoryProvider).taxonomy(kind);
});

final crmOverviewProvider = FutureProvider.autoDispose
    .family<CrmOverview, bool>((ref, mine) {
      _watchContext(ref);
      return ref.watch(crmRepositoryProvider).overview(mine: mine);
    });

/// The first few of my activities due today, for the overview screen.
final todayAgendaProvider = FutureProvider.autoDispose<Paged<Activity>>((ref) {
  _watchContext(ref);
  return ref
      .watch(crmRepositoryProvider)
      .activities(const ActivityQuery(view: ActivityView.today, mine: true));
});

final leadProvider = FutureProvider.autoDispose.family<Lead, String>((ref, id) {
  _watchContext(ref);
  return ref.watch(crmRepositoryProvider).lead(id);
});

final leadActivitiesProvider = FutureProvider.autoDispose
    .family<List<Activity>, String>((ref, leadId) {
      _watchContext(ref);
      return ref.watch(crmRepositoryProvider).leadActivities(leadId);
    });

final contactProvider = FutureProvider.autoDispose.family<Contact, String>((
  ref,
  id,
) {
  _watchContext(ref);
  return ref.watch(crmRepositoryProvider).contact(id);
});

/// A list that loads a page at a time as the user scrolls.
class PagedState<T> {
  const PagedState({
    this.items = const [],
    this.total = 0,
    this.hasMore = false,
    this.loading = true,
    this.loadingMore = false,
    this.error,
  });

  final List<T> items;
  final int total;
  final bool hasMore;

  /// The first page is in flight and there is nothing to show yet.
  final bool loading;
  final bool loadingMore;

  /// Why the last load failed, if it did.
  final Object? error;

  PagedState<T> copyWith({
    List<T>? items,
    int? total,
    bool? hasMore,
    bool? loading,
    bool? loadingMore,
    Object? error = _keep,
  }) => PagedState<T>(
    items: items ?? this.items,
    total: total ?? this.total,
    hasMore: hasMore ?? this.hasMore,
    loading: loading ?? this.loading,
    loadingMore: loadingMore ?? this.loadingMore,
    error: error == _keep ? this.error : error,
  );
}

const Object _keep = Object();

abstract class PagedController<T> extends Notifier<PagedState<T>> {
  int _page = 0;

  /// Bumped by every refresh, so a slow response for an older one is dropped.
  int _generation = 0;

  Future<Paged<T>> fetch(int page);

  @override
  PagedState<T> build() {
    _watchContext(ref);
    _page = 0;
    Future.microtask(refresh);
    return PagedState<T>();
  }

  /// Reloads from the first page, keeping the current rows on screen until
  /// the new ones arrive (pull to refresh).
  Future<void> refresh() async {
    final generation = ++_generation;
    state = state.copyWith(loading: state.items.isEmpty, error: null);
    try {
      final result = await fetch(1);
      if (!ref.mounted || generation != _generation) return;
      _page = 1;
      state = PagedState<T>(
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
        loading: false,
      );
    } catch (e) {
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(loading: false, error: e);
    }
  }

  Future<void> loadMore() async {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    final generation = _generation;
    state = state.copyWith(loadingMore: true, error: null);
    try {
      final result = await fetch(_page + 1);
      if (!ref.mounted || generation != _generation) return;
      _page++;
      state = state.copyWith(
        items: [...state.items, ...result.items],
        total: result.total,
        hasMore: result.hasMore,
        loadingMore: false,
      );
    } catch (e) {
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(loadingMore: false, error: e);
    }
  }
}

class LeadsController extends PagedController<Lead> {
  LeadsController(this.query);

  final LeadQuery query;

  @override
  Future<Paged<Lead>> fetch(int page) =>
      ref.read(crmRepositoryProvider).leads(query, page: page);
}

class ActivitiesController extends PagedController<Activity> {
  ActivitiesController(this.query);

  final ActivityQuery query;

  @override
  Future<Paged<Activity>> fetch(int page) =>
      ref.read(crmRepositoryProvider).activities(query, page: page);
}

class ContactsController extends PagedController<Contact> {
  ContactsController(this.query);

  final ContactQuery query;

  @override
  Future<Paged<Contact>> fetch(int page) =>
      ref.read(crmRepositoryProvider).contacts(query, page: page);
}

final leadsProvider = NotifierProvider.autoDispose
    .family<LeadsController, PagedState<Lead>, LeadQuery>(LeadsController.new);

final activitiesProvider = NotifierProvider.autoDispose
    .family<ActivitiesController, PagedState<Activity>, ActivityQuery>(
      ActivitiesController.new,
    );

final contactsProvider = NotifierProvider.autoDispose
    .family<ContactsController, PagedState<Contact>, ContactQuery>(
      ContactsController.new,
    );

extension CrmRefresh on WidgetRef {
  /// After a lead or its activities change: everything that shows either.
  void refreshLeadViews([String? leadId]) {
    invalidate(leadsProvider);
    invalidate(activitiesProvider);
    invalidate(crmOverviewProvider);
    invalidate(todayAgendaProvider);
    if (leadId != null) {
      invalidate(leadProvider(leadId));
      invalidate(leadActivitiesProvider(leadId));
    }
  }

  void refreshContactViews([String? contactId]) {
    invalidate(contactsProvider);
    if (contactId != null) invalidate(contactProvider(contactId));
  }
}
