# Task 28: Reader Shell UI

Status: DONE
Wave: 8
Depends on: task-25, task-26

## Scope & Owned Files
- Extend `/reader` route into full shell:
  - sidebar library rail (from task-01 shell): saved articles list (title, domain, date, unread dot), search filter, add-article input; Ctrl+click opens source URL externally
  - top bar inside reader: breadcrumb (library / article title), font-step +/- and serif toggle, delete article (typed confirm), sync chip
- Empty states: no articles yet (copy + Add CTA), extraction-failed variant from task-25 errors
- Deep link `scholiast://open?url=` routes articles to reader when host is non-video
- Keyboard: `j/k` next/prev annotation placeholder (wired to task-31 later), `f` focus mode (hide rail)

## Acceptance Criteria
- Component tests: library list interactions, routing decisions video-vs-article URL
- Manual gate: add real article → read → adjust typography persists

## Notes
Keep ArticleView (task-26) untouched — compose around it.
