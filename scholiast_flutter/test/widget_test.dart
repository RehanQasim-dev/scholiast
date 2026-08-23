import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/main.dart';

void main() {
  testWidgets('ScholiastApp builds home route with inMemory DB', (tester) async {
    final db = AppDatabase.inMemory();
    addTearDown(db.close);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          databaseProvider.overrideWithValue(db),
        ],
        child: ScholiastApp(db: db),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Home shell should be visible: the Scholiast title or navigation destinations.
    expect(find.textContaining('Scholiast'), findsWidgets);
  });
}
