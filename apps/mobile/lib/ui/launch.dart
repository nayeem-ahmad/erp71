import 'package:url_launcher/url_launcher.dart';

import 'widgets.dart';

// Handing a number or address to the phone's own apps: dialer, messages,
// WhatsApp, mail, browser.

Future<void> callNumber(String number) =>
    _open(Uri(scheme: 'tel', path: _dialable(number)), 'the dialer');

Future<void> textNumber(String number) =>
    _open(Uri(scheme: 'sms', path: _dialable(number)), 'messages');

Future<void> whatsAppNumber(String number) =>
    _open(Uri.https('wa.me', '/${whatsAppDigits(number)}'), 'WhatsApp');

Future<void> emailAddress(String address) =>
    _open(Uri(scheme: 'mailto', path: address.trim()), 'mail');

Future<void> openLink(String url) {
  final trimmed = url.trim();
  // The CRM stores links as typed, often without a scheme.
  final withScheme = trimmed.contains('://') ? trimmed : 'https://$trimmed';
  final uri = Uri.tryParse(withScheme);
  if (uri == null) {
    showToast("That link doesn't look right.", tone: Tone.danger);
    return Future.value();
  }
  return _open(uri, 'the link');
}

/// wa.me wants the full international number, digits only. Numbers here are
/// mostly typed the local Bangladeshi way (`01712-345678`), which is the
/// national trunk `0` followed by the subscriber number.
String whatsAppDigits(String number) {
  final digits = number.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('00')) return digits.substring(2);
  if (digits.startsWith('880')) return digits;
  if (digits.startsWith('0') && digits.length == 11) return '88$digits';
  return digits;
}

String _dialable(String number) => number.replaceAll(RegExp(r'[^\d+*#]'), '');

Future<void> _open(Uri uri, String what) async {
  bool opened;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (!opened) {
    showToast("Couldn't open $what on this phone.", tone: Tone.danger);
  }
}
