# Portable anchoring with three-tiered fallback

Highlights store both an XPath DOM address and a portable text-quote anchor (`quote` + prefix/suffix context + occurrence index).

When dynamic web content or DOM refactors break XPath, resolution falls back to a three-tiered ladder (`findTextQuoteRange`): exact match $\to$ whitespace-insensitive match $\to$ fuzzy edit-distance match (`shared/fuzzy-match.ts`). This ensures single-character edits or whitespace variations never orphan user annotations.

