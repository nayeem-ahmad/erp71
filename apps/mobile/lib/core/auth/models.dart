import '../format/format.dart' show initialsOf;

/// The signed-in person, from `user` in a sign-in answer or from `/auth/me`.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    this.name,
    this.avatarUrl,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
    id: json['id'] as String,
    email: json['email'] as String,
    name: json['name'] as String?,
    avatarUrl: json['avatar_url'] as String?,
  );

  final String id;
  final String email;
  final String? name;
  final String? avatarUrl;

  String get displayName =>
      (name?.trim().isNotEmpty ?? false) ? name!.trim() : email;

  String get initials => initialsOf(displayName);
}

/// A branch (store) of a workspace the member has access to.
class Branch {
  const Branch({required this.id, required this.name});

  final String id;
  final String name;
}

/// One shop the user belongs to — an entry of `tenants` in a sign-in answer
/// or in `/auth/me`.
class Workspace {
  const Workspace({
    required this.id,
    required this.name,
    required this.role,
    required this.permissions,
    this.roleName,
    this.timezone,
    this.branches = const [],
    this.planFeatures = const {},
    this.subscriptionStatus,
    this.pendingActivation = false,
  });

  factory Workspace.fromJson(Map<String, dynamic> json) {
    final tenantRole = json['tenant_role'];
    final subscription = json['subscription'];
    final plan = subscription is Map<String, dynamic>
        ? subscription['plan']
        : null;
    final features = plan is Map<String, dynamic>
        ? plan['features_json']
        : null;
    return Workspace(
      id: json['id'] as String,
      name: (json['name'] as String?) ?? 'Workspace',
      role: (json['role'] as String?) ?? '',
      roleName: tenantRole is Map<String, dynamic>
          ? tenantRole['name'] as String?
          : null,
      permissions: {
        for (final p in (json['permissions'] as List<dynamic>? ?? const []))
          if (p is String) p,
      },
      timezone: json['timezone'] as String?,
      branches: [
        for (final store in (json['stores'] as List<dynamic>? ?? const []))
          if (store is Map<String, dynamic> && store['id'] is String)
            Branch(
              id: store['id'] as String,
              name: (store['name'] as String?) ?? 'Branch',
            ),
      ],
      planFeatures: features is Map<String, dynamic> ? features : const {},
      subscriptionStatus: subscription is Map<String, dynamic>
          ? subscription['status'] as String?
          : null,
      pendingActivation: json['pending_activation'] == true,
    );
  }

  final String id;
  final String name;

  /// `OWNER`, or the membership role for everyone else.
  final String role;

  /// The custom role's name, when the member has one.
  final String? roleName;

  /// What this member may do here: the union of their grants across every
  /// branch they can reach, as the server resolved it. An owner's list is
  /// complete.
  final Set<String> permissions;

  /// IANA zone the workspace keeps its days in, e.g. `Asia/Dhaka`.
  final String? timezone;

  /// Branches the member can reach.
  final List<Branch> branches;

  /// The plan's entitlements (`subscription.plan.features_json`), add-ons
  /// already merged in by the server.
  final Map<String, dynamic> planFeatures;

  /// `ACTIVE`, `TRIALING`, `PAST_DUE`, …; null with no subscription at all.
  final String? subscriptionStatus;

  /// Signed up but not yet paid for and switched on.
  final bool pendingActivation;

  /// What the backend's SubscriptionAccessGuard lets through to paid modules.
  bool get subscriptionActive =>
      subscriptionStatus == 'ACTIVE' || subscriptionStatus == 'TRIALING';

  bool get isOwner => role == 'OWNER';

  bool can(String permission) => isOwner || permissions.contains(permission);

  /// A boolean plan entitlement, read the way the web's
  /// `normalizePlanFeatures` reads one: `true`, `"true"`/`"1"`, or a positive
  /// number. Absent means off.
  bool hasPlanFeature(String key) {
    final raw = planFeatures[key];
    return switch (raw) {
      bool value => value,
      num value => value > 0,
      String value => value.toLowerCase() == 'true' || value == '1',
      _ => false,
    };
  }

  String get roleLabel {
    if (isOwner) return 'Owner';
    if (roleName != null && roleName!.isNotEmpty) return roleName!;
    final lower = role.toLowerCase().replaceAll('_', ' ');
    return lower.isEmpty
        ? 'Member'
        : lower[0].toUpperCase() + lower.substring(1);
  }
}
