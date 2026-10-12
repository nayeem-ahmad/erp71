// Response bodies shaped like the backend's, trimmed to the fields the app
// reads plus a few it must ignore.

Map<String, Object?> workspaceJson({
  String id = 'tenant-1',
  String name = 'Rahman Traders',
  String role = 'MANAGER',
  List<String> permissions = const [
    'VIEW_LEADS',
    'VIEW_CRM_INTERACTIONS',
    'CREATE_CRM_INTERACTIONS',
    'MANAGE_CRM_TASKS',
  ],
  Object? premiumCrm = true,
  Object? premiumAi = false,
  String status = 'ACTIVE',
  List<Map<String, Object?>> stores = const [
    {'id': 'store-1', 'name': 'Main Store', 'tenant_id': 'tenant-1'},
  ],
}) => {
  'id': id,
  'name': name,
  'storefront_slug': null,
  'timezone': 'Asia/Dhaka',
  'role': role,
  'tenant_role': role == 'OWNER' ? null : {'id': 'role-1', 'name': 'CRM User'},
  'record_scope': 'ALL',
  'permissions': permissions,
  'stores': stores,
  'pending_activation': false,
  'subscription': {
    'status': status,
    'plan': {
      'code': 'PREMIUM',
      'name': 'Premium',
      'features_json': {
        'premiumCrm': premiumCrm,
        'premiumAi': premiumAi,
        'aiCreditsMonthly': 100,
      },
    },
  },
};

Map<String, Object?> userJson() => {
  'id': 'user-1',
  'email': 'karim@rahman.com.bd',
  'name': 'Karim Rahman',
  'preferred_locale': 'en',
  'is_platform_admin': false,
  'email_verified': true,
};

Map<String, Object?> authResponse({
  List<Map<String, Object?>>? tenants,
  String accessToken = 'access-1',
  String refreshToken = 'refresh-1',
}) => {
  'access_token': accessToken,
  'refresh_token': refreshToken,
  'expires_in': 3600,
  'is_platform_admin': false,
  'user': userJson(),
  'tenants': tenants ?? [workspaceJson()],
  'is_new_user': false,
};

Map<String, Object?> meJson({List<Map<String, Object?>>? tenants}) => {
  ...userJson(),
  'avatar_url': null,
  'tenants': tenants ?? [workspaceJson()],
};

Map<String, Object?> leadJson({
  String id = 'lead-1',
  String name = 'Rahim Uddin',
  String status = 'CONTACTED',
  String priority = 'HIGH',
  int score = 55,
  String? nextStep = 'Call back about pricing',
  String? nextStepDate = '2026-09-27T04:00:00.000Z',
  String? mobile = '01712-345678',
}) => {
  'id': id,
  'tenant_id': 'tenant-1',
  'store_id': null,
  'name': name,
  'mobile': mobile,
  'custom_fields': {'budget': '50000'},
  'email': 'rahim@example.com',
  'address': null,
  'mobile_norm': '+8801712345678',
  'email_norm': 'rahim@example.com',
  'linkedin_norm': null,
  'category': 'RETAIL',
  'category_id': 'cat-1',
  'priority': priority,
  'remarks': '',
  'source': 'FACEBOOK',
  'source_id': 'src-1',
  'status': status,
  'lost_reason': null,
  'score': score,
  'linkedin_url': null,
  'fb_url': 'facebook.com/rahim',
  'x_url': null,
  'website_url': null,
  'photo_url': null,
  'photo_storage_key': null,
  'next_step': nextStep,
  'next_step_date': nextStepDate,
  'next_step_assigned_to': 'user-1',
  'next_activity_id': nextStep == null ? null : 'act-1',
  'assigned_to': 'user-1',
  'last_contacted_at': '2026-09-25T10:03:11.000Z',
  'last_activity_at': '2026-09-25T10:03:11.000Z',
  'closed_at': null,
  'converted_customer_id': null,
  'created_by': 'user-1',
  'created_at': '2026-09-20T05:00:00.000Z',
  'updated_at': '2026-09-25T10:03:11.120Z',
  'assignee': {
    'id': 'user-1',
    'name': 'Karim Rahman',
    'email': 'karim@rahman.com.bd',
  },
  'nextStepAssignee': {
    'id': 'user-1',
    'name': 'Karim Rahman',
    'email': 'karim@rahman.com.bd',
  },
  'creator': {'id': 'user-1', 'name': null, 'email': 'karim@rahman.com.bd'},
  'convertedCustomer': null,
  'sourceOption': {
    'id': 'src-1',
    'code': 'FACEBOOK',
    'name': 'Facebook',
    'score_weight': 15,
  },
  'categoryOption': {'id': 'cat-1', 'code': 'RETAIL', 'name': 'Retail'},
};

Map<String, Object?> activityJson({
  String id = 'act-1',
  String status = 'PLANNED',
  String? subject = 'Call back about pricing',
  String? summary,
  String? dueAt = '2026-09-27T04:00:00.000Z',
  String? completedAt,
  String createdAt = '2026-09-20T05:00:00.000Z',
}) => {
  'id': id,
  'tenant_id': 'tenant-1',
  'store_id': null,
  'lead_id': 'lead-1',
  'customer_id': null,
  'purpose_id': 'purpose-1',
  'channel_id': status == 'DONE' ? 'channel-1' : null,
  'channel_code': status == 'DONE' ? 'CALL' : null,
  'subject': subject,
  'status': status,
  'due_at': dueAt,
  'completed_at': completedAt,
  'summary': summary,
  'outcome': null,
  'notes': null,
  'direction': 'OUTBOUND',
  'assigned_to': 'user-1',
  'created_by': 'user-1',
  'origin': 'MANUAL',
  'is_approved': false,
  'approved_by': null,
  'approved_at': null,
  'legacy_source': null,
  'legacy_id': null,
  'created_at': createdAt,
  'updated_at': createdAt,
  'lead': {'id': 'lead-1', 'name': 'Rahim Uddin', 'mobile': '01712-345678'},
  'customer': null,
  'purpose': {
    'id': 'purpose-1',
    'code': 'GENERAL',
    'name': 'General',
    'icon': '📌',
  },
  'channel': status == 'DONE'
      ? {'id': 'channel-1', 'code': 'CALL', 'name': 'Call', 'icon': '📞'}
      : null,
  'assignee': {
    'id': 'user-1',
    'name': 'Karim Rahman',
    'email': 'karim@rahman.com.bd',
  },
  'creator': {
    'id': 'user-1',
    'name': 'Karim Rahman',
    'email': 'karim@rahman.com.bd',
  },
  'approver': null,
};

Map<String, Object?> contactJson({String id = 'contact-1'}) => {
  'id': id,
  'tenant_id': 'tenant-1',
  'name': 'Nusrat Jahan',
  'company': 'Acme Ltd',
  'designation': 'Buyer',
  'mobile': '01811111111',
  'phone': null,
  'email': 'nusrat@acme.com',
  'address': null,
  'website_url': null,
  'linkedin_url': null,
  'photo_url': null,
  'photo_storage_key': null,
  'notes': null,
  'capture_source': 'BUSINESS_CARD',
  'assigned_to': null,
  'created_by': 'user-1',
  'created_at': '2026-09-20T05:00:00.000Z',
  'updated_at': '2026-09-20T05:00:00.000Z',
  'assignee': null,
  'creator': {
    'id': 'user-1',
    'name': 'Karim Rahman',
    'email': 'karim@rahman.com.bd',
  },
  'attachments': <Object?>[],
};

Map<String, Object?> overviewJson() => {
  'filters': {'from': '2026-08-28', 'to': '2026-09-26', 'mine': true},
  'pipeline': {
    'counts': {
      'NEW': 4,
      'CONTACTED': 7,
      'QUALIFIED': 2,
      'LOST': 3,
      'CONVERTED': 9,
    },
    'open': 13,
    'created_in_period': 6,
    'converted_in_period': 2,
    'lost_in_period': 1,
    'conversion_rate_pct': 66.7,
    'avg_days_to_convert': 12.5,
    'unassigned': 3,
    'stale': 5,
    'stale_after_days': 14,
  },
  'follow_ups': {
    'due_today': 2,
    'overdue': 4,
    'total_pending': 11,
    'completed_in_period': 7,
  },
  'activity': {
    'logged_in_period': 20,
    'leads_touched': 9,
    'by_type': [
      {'code': 'CALL', 'name': 'Call', 'count': 12},
    ],
  },
  'sources': <Object?>[],
  'owners': <Object?>[],
  'campaigns': {
    'sent_in_period': 0,
    'delivered': 0,
    'failed': 0,
    'attributed_revenue': 0,
    'attributed_orders': 0,
    'recent': <Object?>[],
  },
};

List<Map<String, Object?>> channelsJson() => [
  for (final (id, code, name, icon, active) in [
    ('channel-1', 'CALL', 'Call', '📞', true),
    ('channel-2', 'WHATSAPP', 'WhatsApp', '🟢', true),
    ('channel-3', 'FAX', 'Fax', null, false),
  ])
    {
      'id': id,
      'tenant_id': 'tenant-1',
      'code': code,
      'name': name,
      'icon': icon,
      'sort_order': 0,
      'is_system': true,
      'is_active': active,
      'created_at': '2026-09-01T00:00:00.000Z',
      'updated_at': '2026-09-01T00:00:00.000Z',
    },
];

/// An owner of two branches: every business area plus the CRM.
Map<String, Object?> ownerWorkspaceJson() => workspaceJson(
  role: 'OWNER',
  permissions: const [],
  stores: const [
    {'id': 'store-1', 'name': 'Main Store', 'tenant_id': 'tenant-1'},
    {'id': 'store-2', 'name': 'Mirpur Branch', 'tenant_id': 'tenant-1'},
  ],
);

Map<String, Object?> daySalesJson(String date, num net, {int count = 4}) => {
  'date': date,
  'gross': net,
  'returns': 0,
  'net': net,
  'count': count,
  'returns_count': 0,
  'avg_ticket': count > 0 ? net / count : null,
};

/// GET /mobile/pulse for Wednesday 7 October 2026.
Map<String, Object?> pulseJson({
  num todayNet = 6000,
  bool payables = true,
  num returns = 0,
}) => {
  'store_id': null,
  'date': '2026-10-07',
  'generated_at': '2026-10-07T08:00:00.000Z',
  'today': {
    ...daySalesJson('2026-10-07', todayNet),
    'returns': returns,
    'returns_count': returns > 0 ? 1 : 0,
  },
  'yesterday': daySalesJson('2026-10-06', 4000, count: 2),
  'last_week': daySalesJson('2026-09-30', 0, count: 0),
  'change': {'vs_yesterday_pct': 50, 'vs_last_week_pct': null},
  'margin': {
    'gross_profit': 1500,
    'margin_pct': 25,
    'costed_items': 4,
    'uncosted_items': 0,
    'units': 6,
  },
  'tenders': [
    {'key': 'bkash', 'label': 'bKash', 'amount': 2500},
    {'key': 'cash', 'label': 'Cash', 'amount': 1500},
  ],
  'trend': [
    for (final (i, net) in [1000, 0, 2000, 3000, 2500, 4000, todayNet].indexed)
      {
        'date': '2026-10-0${i + 1}',
        'net_sales': net,
        'orders': 2,
        'returns': 0,
      },
  ],
  'receivables': {'outstanding': 8000, 'customers_owing': 5},
  'payables': payables ? {'outstanding': 12000, 'suppliers_owing': 3} : null,
};

Map<String, Object?> tillJson({
  String id = 'sess-1',
  String status = 'OPEN',
  String cashier = 'Rina Akter',
  String store = 'Main Store',
  num? expected = 1500,
  num? closing,
  num? variance,
  int sales = 1,
  num salesTotal = 500,
}) => {
  'id': id,
  'status': status,
  'store': {'id': 'store-1', 'name': store},
  'counter': {'id': 'c1', 'name': 'Counter 1', 'counter_number': 1},
  'cashier': {'id': 'u-$id', 'name': cashier},
  'opened_at': '2026-10-07T03:00:00.000Z',
  'closed_at': status == 'CLOSED' ? '2026-10-07T07:00:00.000Z' : null,
  'opening_cash': 1000,
  'sales_count': sales,
  'sales_total': salesTotal,
  'cash_takings': status == 'OPEN' ? 500 : null,
  'expected_cash': expected,
  'closing_cash': closing,
  'variance': variance,
};

/// GET /cashier-sessions/overview: one till open, one closed ৳600 short.
Map<String, Object?> cashierOverviewJson() => {
  'store_id': null,
  'open': [tillJson()],
  'closed_today': [
    tillJson(
      id: 'sess-2',
      status: 'CLOSED',
      cashier: 'Kamal Hossain',
      store: 'Mirpur Branch',
      expected: 4500,
      closing: 3900,
      variance: -600,
      sales: 7,
      salesTotal: 3200,
    ),
  ],
  'totals': {
    'open_count': 1,
    'expected_cash': 1500,
    'sales_total': 3700,
    'closed_count': 1,
    'short': -600,
    'over': 0,
  },
};

/// GET /cashier-sessions/sess-1/summary — camelCase, as the backend sends it.
Map<String, Object?> tillSummaryJson() => {
  'sessionId': 'sess-1',
  'salesCount': 1,
  'salesTotal': 500,
  'cashTakings': 500,
  'refunds': 0,
  'openingCash': 1000,
  'cashIn': 200,
  'cashOut': 200,
  'expectedCash': 1500,
  'closingCash': null,
  'variance': null,
  'paymentBreakdown': [
    {'method': 'Cash', 'amount': 500},
  ],
};

List<Map<String, Object?>> cashMovementsJson() => [
  {
    'id': 'tx-1',
    'tenant_id': 'tenant-1',
    'session_id': 'sess-1',
    'amount': '-200.00',
    'type': 'PAYOUT',
    'description': 'Tea for staff',
    'created_at': '2026-10-07T05:00:00.000Z',
  },
  {
    'id': 'tx-2',
    'tenant_id': 'tenant-1',
    'session_id': 'sess-1',
    'amount': '200.00',
    'type': 'OTHER',
    'description': null,
    'created_at': '2026-10-07T05:30:00.000Z',
  },
];
