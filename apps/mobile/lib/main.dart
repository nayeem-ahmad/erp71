import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      // A failed request is shown with a "Try again" button; retrying behind
      // the user's back would repeat a 403 or a 404 for nothing.
      retry: (_, _) => null,
      child: const Erp71App(),
    ),
  );
}
