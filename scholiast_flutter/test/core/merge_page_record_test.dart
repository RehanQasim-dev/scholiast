import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/algorithms/merge_page_record.dart';
import 'package:scholiast_flutter/core/models/models.dart';

void main() {
  group('Comment Marker Helpers', () {
    test('commentId extracts timestamp or falls back to raw text', () {
      expect(commentId('hello<!--timestamp:1234567890-->'), '1234567890');
      expect(
        commentId('hello<!--timestamp:1234567890--><!--edited:1234567999-->'),
        '1234567890',
      );
      expect(commentId('legacy raw comment'), 'legacy raw comment');
    });

    test('commentVersion extracts edited timestamp, then timestamp, or 0', () {
      expect(
        commentVersion('note<!--timestamp:100--><!--edited:200-->'),
        200,
      );
      expect(
        commentVersion('note<!--timestamp:150-->'),
        150,
      );
      expect(
        commentVersion('legacy comment without timestamp'),
        0,
      );
    });

    test('jsParseInt parses integer prefix like JS parseInt', () {
      expect(jsParseInt('123'), 123);
      expect(jsParseInt('  +456abc'), 456);
      expect(jsParseInt('-789xyz'), -789);
      expect(jsParseInt('abc'), isNull);
      expect(jsParseInt(''), isNull);
    });
  });

  group('mergeKeyed Generic 3-Way Merge', () {
    test('brand new entity on local is kept', () {
      final base = <String, String>{};
      final local = {'a': 'local_a'};
      final remote = <String, String>{};
      final tombs = <String, int>{};

      final result = mergeKeyed<String>(
        base,
        local,
        remote,
        tombs,
        (s) => 1,
        (l, r) => l,
        1000,
      );

      expect(result.kept, {'a': 'local_a'});
      expect(result.tombs, isEmpty);
    });

    test('deleted on remote gets tombstoned', () {
      final base = {'a': 'base_a'};
      final local = {'a': 'local_a'};
      final remote = <String, String>{};
      final tombs = <String, int>{};

      final result = mergeKeyed<String>(
        base,
        local,
        remote,
        tombs,
        (s) => 1,
        (l, r) => l,
        1000,
      );

      expect(result.kept, isEmpty);
      expect(result.tombs, {'a': 1000});
    });

    test('deleted on local gets tombstoned', () {
      final base = {'a': 'base_a'};
      final local = <String, String>{};
      final remote = {'a': 'remote_a'};
      final tombs = <String, int>{};

      final result = mergeKeyed<String>(
        base,
        local,
        remote,
        tombs,
        (s) => 1,
        (l, r) => l,
        1000,
      );

      expect(result.kept, isEmpty);
      expect(result.tombs, {'a': 1000});
    });

    test('tombstone is garbage collected after 30 days', () {
      final base = <String, String>{};
      final local = <String, String>{};
      final remote = <String, String>{};
      const now = 1000000000000;
      final tombs = {
        'fresh': now - 1000,
        'expired': now - (tombstoneRetentionMs + 1000),
      };

      final result = mergeKeyed<String>(
        base,
        local,
        remote,
        tombs,
        (s) => 1,
        (l, r) => l,
        now,
      );

      expect(result.tombs.containsKey('fresh'), isTrue);
      expect(result.tombs.containsKey('expired'), isFalse);
    });
  });

  group('mergeNotes Scoped Comments Merge', () {
    test('merges and sorts comments from both sides in numerical order', () {
      final baseNotes = ['orig<!--timestamp:100-->'];
      final localNotes = [
        'orig<!--timestamp:100-->',
        'local<!--timestamp:300-->',
      ];
      final remoteNotes = [
        'orig<!--timestamp:100-->',
        'remote<!--timestamp:200-->',
      ];
      final tombs = <String, int>{};

      final merged = mergeNotes(
        baseNotes,
        localNotes,
        remoteNotes,
        tombs,
        'hl1',
        1000,
      );

      expect(merged, [
        'orig<!--timestamp:100-->',
        'remote<!--timestamp:200-->',
        'local<!--timestamp:300-->',
      ]);
    });
  });

  group('Golden Tests (Byte-for-byte Parity with TypeScript)', () {
    String readFixtureFile(String filename) {
      final candidates = [
        'test/fixtures/$filename',
        '../android/app/src/test/resources/com/scholiast/android/domain/sync/merge/$filename',
      ];
      for (final path in candidates) {
        final f = File(path);
        if (f.existsSync()) {
          return f.readAsStringSync();
        }
      }
      throw StateError('Fixture file $filename not found in $candidates');
    }

    PageRecord? decodeNullable(dynamic element) {
      if (element == null) return null;
      return PageRecord.fromJson(element as Map<String, dynamic>);
    }

    test('golden fixtures match the TypeScript merge output byte-for-byte', () {
      final fixtures = jsonDecode(readFixtureFile('merge_page_record_fixtures.json'))
          as Map<String, dynamic>;
      final expected = jsonDecode(readFixtureFile('merge_page_record_expected.json'))
          as Map<String, dynamic>;

      final now = (fixtures['now'] as num).toInt();
      final fixtureCases = fixtures['cases'] as List<dynamic>;
      final expectedCases = expected['cases'] as List<dynamic>;

      expect(
        fixtureCases.length,
        equals(expectedCases.length),
        reason: 'same number of cases as the TS golden file',
      );

      for (var i = 0; i < fixtureCases.length; i++) {
        final fc = fixtureCases[i] as Map<String, dynamic>;
        final ec = expectedCases[i] as Map<String, dynamic>;
        final name = fc['name'] as String;
        final base = decodeNullable(fc['base']);
        final local = decodeNullable(fc['local']);
        final remote = decodeNullable(fc['remote']);
        final expectedJson = ec['expectedJson'] as String;

        final merged = mergePageRecord(base, local, remote, now);
        final actual = jsonEncode(merged.toJson());

        expect(
          actual,
          equals(expectedJson),
          reason: 'case[$i] "$name": Dart merge must byte-equal the TS merge',
        );
      }
    });
  });
}
