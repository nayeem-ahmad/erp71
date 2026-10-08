import 'auth/models.dart';
import '../features/crm/access.dart' show canUseCrm;

/// The store permissions behind each area of the app, mirroring the sets in
/// apps/backend/src/auth/permission-sets.ts. The server enforces them; these
/// only decide what the app offers, so a member is never shown a tab every
/// request from which would be refused.
abstract final class AreaPermissions {
  /// `SALES_READ`: the business pulse, guarded as Sales › Overview.
  static const sales = {
    'CREATE_SALE',
    'CREATE_SALES_ORDER',
    'CREATE_QUOTATION',
    'CREATE_RETURN',
    'VIEW_CUSTOMER_CREDIT',
    'MANAGE_CUSTOMER_CREDIT',
    'WRITE_OFF_CUSTOMER_DEBT',
    'VIEW_FINANCIAL_REPORTS',
    'VIEW_CONSOLIDATED_REPORTS',
    'EDIT_PRODUCT_PRICES',
  };

  /// `POS_STAFF`: the till monitor, guarded as the cashier-session reads.
  static const tills = {'CREATE_SALE', 'MANAGE_COUNTERS'};

  /// Reading every branch at once (`storeId=all`).
  static const consolidated = 'VIEW_CONSOLIDATED_REPORTS';
}

/// What the signed-in member can open on the phone in one workspace.
class MobileAccess {
  const MobileAccess({
    required this.home,
    required this.cashiers,
    required this.crm,
  });

  factory MobileAccess.of(Workspace workspace) {
    bool any(Set<String> permissions) =>
        workspace.isOwner || permissions.any(workspace.permissions.contains);
    return MobileAccess(
      // The pulse sits behind SubscriptionAccessGuard like every paid module.
      home: workspace.subscriptionActive && any(AreaPermissions.sales),
      cashiers: any(AreaPermissions.tills),
      crm: canUseCrm(workspace),
    );
  }

  /// The business pulse on the home tab.
  final bool home;

  /// Open tills and today's closed shifts.
  final bool cashiers;

  /// Leads, activities and contacts.
  final bool crm;

  bool get any => home || cashiers || crm;

  /// Someone who runs the shop, not only its sales pipeline. They get the
  /// business tabs, with the CRM folded into one; a CRM-only member keeps the
  /// CRM's own four tabs.
  bool get business => home || cashiers;

  /// Where signing in, or a link to somewhere this member cannot go, lands.
  String get startLocation => home
      ? '/home'
      : cashiers
      ? '/cashiers'
      : '/crm';

  /// Whether [location] is an area this member may open. Anything outside the
  /// three areas (account, workspace picker) is always allowed.
  bool allows(String location) {
    bool under(String root) =>
        location == root || location.startsWith('$root/');
    if (under('/more')) return business;
    if (under('/home')) return home;
    if (under('/cashiers')) return cashiers;
    if (under('/crm') ||
        under('/leads') ||
        under('/activities') ||
        under('/contacts')) {
      return crm;
    }
    return true;
  }
}
