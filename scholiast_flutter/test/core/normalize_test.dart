import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/algorithms/normalize.dart';

void main() {
  group('Normalize - tracking-param stripping', () {
    const ephemeralParamsList = [
      't',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'ref_src',
      'source',
      'src',
      'fbclid',
      'gclid',
      'dclid',
      'msclkid',
      'twclid',
      'mc_cid',
      'mc_eid',
      '_ga',
      '_gl',
      'si',
    ];

    test('strips utm_source utm_medium utm_campaign fbclid _ga and keeps other params', () {
      expect(
        normalizeUrl(
          'https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1',
        ),
        'https://example.com/article?x=1',
      );
    });

    test('strips t and si but keeps list', () {
      expect(
        normalizeUrl(
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc',
        ),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
      );
    });

    test('strips t but keeps start', () {
      expect(
        normalizeUrl(
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45',
        ),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45',
      );
    });

    test('strips ref ref_src source src but keeps an unnamed utm param', () {
      expect(
        normalizeUrl(
          'https://example.com/path?utm_foo=kept&src=stripped&ref_src=stripped&source=stripped&ref=stripped',
        ),
        'https://example.com/path?utm_foo=kept',
      );
    });

    test('strips every one of the 20 EPHEMERAL_PARAMS', () {
      for (final param in ephemeralParamsList) {
        final url = 'https://example.com/p?$param=value&keep=1';
        expect(
          normalizeUrl(url),
          'https://example.com/p?keep=1',
          reason: 'param $param must be stripped',
        );
      }
    });

    test('strips a bare param with no value', () {
      expect(
        normalizeUrl('https://example.com/p?t&v=1'),
        'https://example.com/p?v=1',
      );
    });

    test('strips params whose name is percent-encoded in the url', () {
      expect(
        normalizeUrl('https://example.com/p?utm%5Fsource=x&a=1'),
        'https://example.com/p?a=1',
      );
    });

    test('preserves original param order', () {
      expect(
        normalizeUrl('https://example.com/p?b=2&a=1'),
        'https://example.com/p?b=2&a=1',
      );
    });
  });

  group('Normalize - structure', () {
    test('drops the fragment', () {
      expect(
        normalizeUrl('https://example.com/path/page#frag'),
        'https://example.com/path/page',
      );
      expect(
        normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment&foo=bar'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
    });

    test('keeps a trailing slash on a non-empty path', () {
      expect(
        normalizeUrl('https://example.com/path/page/'),
        'https://example.com/path/page/',
      );
    });

    test('adds a slash for an empty path', () {
      expect(
        normalizeUrl('https://example.com'),
        'https://example.com/',
      );
    });

    test('lowercases scheme and host', () {
      expect(
        normalizeUrl('HTTPS://EXAMPLE.COM/'),
        'https://example.com/',
      );
    });

    test('drops default ports but keeps non-default ones', () {
      expect(
        normalizeUrl('http://example.com:80/'),
        'http://example.com/',
      );
      expect(
        normalizeUrl('https://example.com:443/'),
        'https://example.com/',
      );
      expect(
        normalizeUrl('http://localhost:8080/x'),
        'http://localhost:8080/x',
      );
    });

    test('resolves dot segments', () {
      expect(
        normalizeUrl('https://example.com/a/b/../c/./d'),
        'https://example.com/a/c/d',
      );
    });

    test('re-encodes the query exactly like URLSearchParams', () {
      expect(
        normalizeUrl('https://example.com/a%20b?q=hello%20world'),
        'https://example.com/a%20b?q=hello+world',
      );
      expect(
        normalizeUrl('https://example.com/x?r=100%25'),
        'https://example.com/x?r=100%25',
      );
    });

    test('returns input unchanged when it cannot be parsed', () {
      expect(normalizeUrl('not a url'), 'not a url');
      expect(
        normalizeUrl('https://example.com/a b'),
        'https://example.com/a b',
      );
    });
  });

  group('Normalize - extractVideoId', () {
    test('extracts from watch with v anywhere in the query', () {
      expect(
        extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=5'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/watch?t=60&v=dQw4w9WgXcQ&start=30'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'),
        'dQw4w9WgXcQ',
      );
    });

    test('extracts from youtu be short links', () {
      expect(
        extractVideoId('https://youtu.be/dQw4w9WgXcQ'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=30'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://youtu.be/dQw4w9WgXcQ/extra/path'),
        'dQw4w9WgXcQ',
      );
    });

    test('extracts from shorts embed and live', () {
      expect(
        extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ/extra'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=45'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'),
        'dQw4w9WgXcQ',
      );
      expect(
        extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share'),
        'dQw4w9WgXcQ',
      );
    });

    test('returns null for invalid or non-YouTube urls', () {
      expect(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), isNull);
      expect(extractVideoId('https://www.youtube.com/watch?v='), isNull);
      expect(extractVideoId('https://www.youtube.com/watch'), isNull);
      expect(extractVideoId('https://www.youtube.com/'), isNull);
      expect(extractVideoId('https://youtu.be/'), isNull);
      expect(extractVideoId('https://www.youtube.com/shorts/'), isNull);
      expect(extractVideoId('not a url'), isNull);
      expect(extractVideoId(''), isNull);
    });
  });

  group('Normalize - urlHash / pageFileName', () {
    const hashFixtures = {
      'https://example.com/article?x=1': 'bbeb724611106d499bfaeeae2808c1e8',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123':
          '459380db164cf39befe833994c12f996',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45':
          '30e4864ca20bce8c335eefe292cd3d2d',
      'https://example.com/path?utm_foo=kept':
          '9d9cf7778600782ef29ec22967de3cc9',
      'https://example.com/': '0f115db062b7c0dd030b16878c99dea5',
      'http://example.com/': '2a1b402420ef46577471cdc7409b0fa2',
      'https://example.com/x?q=a+b&r=100%25':
          '868b1a279795d4516421bfd5bd50780c',
      'https://example.com/a%20b?q=hello+world':
          '65c1417c3fc9fb7b5ace07afb4c752f9',
      'https://example.com/a/c/d': 'ed550e401b1cd8092fdfebd37be49217',
      'https://example.com/path/page/': '253bd110def6ba931e5e03bf2b61ad85',
      'https://example.com/path/page': 'f4487e8e7088d8af42048fbb4a928934',
      'https://youtu.be/dQw4w9WgXcQ': '61e610a9d7fd37bc9df752aa7dd374f0',
      'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share':
          '8bfffba315e07741070a5ecf37ed21bf',
      'https://www.youtube.com/embed/dQw4w9WgXcQ':
          '9a48466f10433f4ba5c859c48b958368',
      'https://www.youtube.com/live/dQw4w9WgXcQ':
          '0c888b3aa897e315ca44982381956578',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2':
          '934ff66f65f4da1f3c34c3789b116ce0',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=30':
          'c47071a1399995ef4d73002507481fb2',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ':
          '71c5a3c2ade54326f3805c0e322f8c69',
    };

    test('urlHash matches the TS fixtures', () {
      for (final entry in hashFixtures.entries) {
        expect(
          urlHash(entry.key),
          entry.value,
          reason: 'hash of ${entry.key}',
        );
      }
    });

    test('urlHash is 32 lowercase hex chars', () {
      for (final entry in hashFixtures.entries) {
        final hash = urlHash(entry.key);
        expect(hash.length, 32);
        expect(hash, hash.toLowerCase());
        expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(hash), isTrue);
      }
    });

    test('pageFileName matches the TS output for the same urls', () {
      for (final entry in hashFixtures.entries) {
        expect(pageFileName(entry.key), 'page-${entry.value}.json');
      }
    });

    test('pageFilePath is the drive appdata path', () {
      expect(
        pageFilePath('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123'),
        'pages/page-459380db164cf39befe833994c12f996.json',
      );
    });

    test('stripped and unstripped urls hash identically', () {
      const base = 'https://youtu.be/dQw4w9WgXcQ';
      expect(
        urlHash(base),
        urlHash(normalizeUrl('$base?t=30')),
      );
      expect(pageFileName(base), 'page-61e610a9d7fd37bc9df752aa7dd374f0.json');
    });

    test('normalize then hash matches the fixture table end to end', () {
      expect(
        urlHash(normalizeUrl(
            'https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1')),
        'bbeb724611106d499bfaeeae2808c1e8',
      );
      expect(
        urlHash(normalizeUrl(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc')),
        '459380db164cf39befe833994c12f996',
      );
      expect(
        urlHash(normalizeUrl(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45')),
        '30e4864ca20bce8c335eefe292cd3d2d',
      );
    });
  });
}
