import { useEffect, useRef } from "react";

export interface TagMatch {
  tag: string;
}

/**
 * Case-insensitive prefix filter over the cached `list_tags` index.
 * Empty prefix (bare `#`) suggests nothing — the user hasn't asked yet.
 */
export function matchTags(tags: string[], prefix: string): TagMatch[] {
  if (!prefix) return [];
  const q = prefix.toLowerCase();
  return tags
    .filter((tag) => tag.toLowerCase().startsWith(q) && tag.toLowerCase() !== q)
    .slice(0, 6)
    .map((tag) => ({ tag }));
}

interface TagAutocompleteProps {
  matches: TagMatch[];
  activeIndex: number;
  onPick: (tag: string) => void;
  onHoverIndex: (index: number) => void;
}

export default function TagAutocomplete({
  matches,
  activeIndex,
  onPick,
  onHoverIndex,
}: TagAutocompleteProps) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    listRef.current
      ?.querySelectorAll("li")
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (matches.length === 0) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Tag suggestions"
      className="absolute bottom-full left-0 z-10 mb-1 max-h-40 w-56 overflow-y-auto rounded-md border border-hairline bg-elevated py-1 shadow-lg"
    >
      {matches.map((match, index) => (
        <li key={match.tag} role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(match.tag);
            }}
            onMouseEnter={() => onHoverIndex(index)}
            className={`block w-full px-3 py-1.5 text-left text-sm ${
              index === activeIndex
                ? "bg-[color:var(--sc-accent)]/20 text-text"
                : "text-text-2"
            }`}
          >
            #{match.tag}
          </button>
        </li>
      ))}
    </ul>
  );
}
