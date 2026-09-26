import 'package:flutter/widgets.dart' show StringCharacters;
import 'package:intl/intl.dart';
import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

// The same rules as the web app's apps/frontend/src/lib/format.ts: money as
// `৳ 1,234.00`, dates as dd/MM/yyyy, and instants rendered in the workspace's
// time zone rather than the phone's, so "due today" means the shop's today and
// a list agrees with the filters the server applied to build it.

final NumberFormat _money = NumberFormat('#,##0.00', 'en_US');
final NumberFormat _count = NumberFormat('#,##0', 'en_US');
final DateFormat _date = DateFormat('dd/MM/yyyy');
final DateFormat _dateTime = DateFormat('dd/MM/yyyy, HH:mm');
final DateFormat _time = DateFormat('HH:mm');
final DateFormat _dayMonth = DateFormat('d MMM');

bool _zonesLoaded = false;
tz.Location? _zone;

/// Set once per workspace from its `timezone` (an IANA name such as
/// `Asia/Dhaka`). Null or unknown falls back to the phone's zone.
void setActiveTimeZone(String? name) {
  if (name == null || name.isEmpty) {
    _zone = null;
    return;
  }
  if (!_zonesLoaded) {
    tzdata.initializeTimeZones();
    _zonesLoaded = true;
  }
  try {
    _zone = tz.getLocation(name);
  } on tz.LocationNotFoundException {
    _zone = null;
  }
}

/// [instant] as wall-clock time in the workspace zone.
DateTime inWorkspaceZone(DateTime instant) {
  final zone = _zone;
  return zone == null ? instant.toLocal() : tz.TZDateTime.from(instant, zone);
}

/// Now, as wall-clock time in the workspace zone.
DateTime workspaceNow() => inWorkspaceZone(DateTime.now());

/// Money in taka, always through here — never a literal currency sign.
String formatBDT(num? amount) => '৳ ${_money.format(amount ?? 0)}';

String formatCount(num? value) => _count.format(value ?? 0);

String formatDate(DateTime? instant) =>
    instant == null ? '—' : _date.format(inWorkspaceZone(instant));

String formatDateTime(DateTime? instant) =>
    instant == null ? '—' : _dateTime.format(inWorkspaceZone(instant));

/// "Today 14:30", "Tomorrow 09:00", "Yesterday 17:05", or "12 Oct 10:00" —
/// the shape a follow-up list scans best in.
String formatDueLabel(DateTime? instant, {DateTime? now}) =>
    instant == null ? '—' : formatWallClock(inWorkspaceZone(instant), now: now);

/// [formatDueLabel] for a time that is already wall-clock, such as one the
/// user just picked.
String formatWallClock(DateTime wallClock, {DateTime? now}) {
  final days = calendarDaysBetween(now ?? workspaceNow(), wallClock);
  final time = _time.format(wallClock);
  return switch (days) {
    0 => 'Today $time',
    1 => 'Tomorrow $time',
    -1 => 'Yesterday $time',
    _ => '${_dayMonth.format(wallClock)} $time',
  };
}

/// "just now", "5 min ago", "3 h ago", "2 d ago", then the date.
String formatAgo(DateTime? instant, {DateTime? now}) {
  if (instant == null) return '—';
  final elapsed = (now ?? DateTime.now()).difference(instant);
  if (elapsed.inMinutes < 1) return 'just now';
  if (elapsed.inHours < 1) return '${elapsed.inMinutes} min ago';
  if (elapsed.inDays < 1) return '${elapsed.inHours} h ago';
  if (elapsed.inDays < 7) return '${elapsed.inDays} d ago';
  return formatDate(instant);
}

/// Whole calendar days from [from] to [to], both already wall-clock times.
int calendarDaysBetween(DateTime from, DateTime to) {
  final a = DateTime.utc(from.year, from.month, from.day);
  final b = DateTime.utc(to.year, to.month, to.day);
  return b.difference(a).inDays;
}

/// Prisma serialises `Decimal` columns as strings; numbers come through as
/// numbers. Either way the caller gets a double, or null for no value.
double? parseDecimal(Object? value) => switch (value) {
  null => null,
  num n => n.toDouble(),
  String s => double.tryParse(s),
  _ => null,
};

DateTime? parseInstant(Object? value) =>
    value is String && value.isNotEmpty ? DateTime.tryParse(value) : null;

/// Up to two initials from a person's or a shop's name.
String initialsOf(String name) {
  final words = name
      .trim()
      .split(RegExp(r'[\s@._-]+'))
      .where((word) => word.isNotEmpty)
      .take(2);
  final letters = words
      .map((word) => word.characters.first.toUpperCase())
      .join();
  return letters.isEmpty ? '?' : letters;
}
