import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  parseNoteMarkdown,
  renderNoteNodes,
  serializeToPlainText,
  stripHiddenIds,
  type NoteNode,
} from "./noteMarkdown";

function renderNote(md: string) {
  return render(
    createElement("div", null, renderNoteNodes(parseNoteMarkdown(md))),
  );
}

// Round-trip exactness corpus: emphasis combos, nested-emphasis edges, bare-url
// detection incl. trailing punctuation, tags with underscores/digits, hidden
// comment ids — plus the malformed-marker and unclosed-syntax cases.
const FIXTURES = [
  "plain text note",
  "two words   spaced  out",
  "multi\nline\nbody",
  "bold **and normal** mix",
  "*italic* leading",
  "**bold** and *italic* together",
  "***triple*** stars",
  "star * alone and ** unclosed",
  "see [Obsidian](https://obsidian.md) for docs",
  "bare https://example.com here",
  "trailing https://example.com. punctuation",
  "many ,.! https://a.b/c?d=e?f! ends",
  "#tag alone",
  "#tag_1/x_y and #second here",
  "note<!--timestamp:1724000000000-->",
  "note<!--timestamp:1724000000000--><!--edited:1724000009999-->",
  "kitchen *sink* with #tag https://x.dev/a?b=c and [l](https://y.io) end",
  "malformed <!--timestamp:abc--> stays",
];

const kinds = (nodes: NoteNode[]): string[] => nodes.map((n) => n.kind);

describe("parseNoteMarkdown → serializeToPlainText round-trip", () => {
  it.each(FIXTURES)("reproduces %j exactly", (fixture) => {
    expect(serializeToPlainText(parseNoteMarkdown(fixture))).toBe(fixture);
  });

  it("tokenizes a mixed note into the expected node kinds", () => {
    const nodes = parseNoteMarkdown(
      'hi **b** #t https://e.co [a](https://b.c)<!--timestamp:5-->',
    );
    expect(kinds(nodes)).toEqual([
      "text",
      "bold",
      "text",
      "tag",
      "text",
      "url",
      "text",
      "link",
      "timestamp-id",
    ]);
  });

  it("keeps trailing punctuation of a bare url as text", () => {
    const nodes = parseNoteMarkdown("go https://a.co.");
    expect(nodes[1]).toMatchObject({ kind: "url", href: "https://a.co" });
    expect(nodes[2]).toMatchObject({ kind: "text", value: "." });
  });
});

describe("renderNoteNodes sanitization", () => {
  const ATTACKS = [
    "<script>alert(1)</script>",
    "[x](javascript:alert(1))",
    '<img src=x onerror="alert(1)">',
    '[click](https://evil.com" onclick="steal())',
    "<b onmouseover=alert(1)>hover</b>",
  ];

  it.each(ATTACKS)("renders %j inert", (attack) => {
    const { container } = renderNote(attack);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("[onmouseover]")).toBeNull();
    if (!attack.includes("<")) return;
    // Raw HTML never reaches the DOM as markup — only as escaped text.
    expect(container.innerHTML).not.toContain("<script");
  });

  it("does not link javascript: urls", () => {
    const { container, getByText } = renderNote("[x](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(getByText(/javascript:alert/)).toBeTruthy();
  });

  it("gives links http(s)-only hrefs opened in a new tab", () => {
    const { getByRole } = renderNote(FIXTURES[8]);
    const link = getByRole("link", { name: "Obsidian" });
    expect(link.getAttribute("href")).toBe("https://obsidian.md");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });
});

describe("hidden ids in render", () => {
  it("shows an edited badge but hides the timestamp id", () => {
    const { container, getByText, queryByText } = renderNote(
      "fixed<!--timestamp:1700000000000--><!--edited:1799999999999-->",
    );
    expect(getByText("edited").tagName).toBe("SPAN");
    expect(queryByText(/1700000000000/)).toBeNull();
    expect(container.textContent).toBe("fixededited");
  });

  it("renders nothing for a timestamp-only id", () => {
    const { container } = renderNote(FIXTURES[14]);
    expect(container.textContent).toBe("note");
  });
});

describe("stripHiddenIds", () => {
  it("removes every valid marker", () => {
    expect(stripHiddenIds("a<!--timestamp:1-->b<!--edited:2-->c")).toBe("abc");
    expect(stripHiddenIds("x<!--timestamp:1--><!--timestamp:2-->")).toBe("x");
  });

  it("leaves malformed markers verbatim", () => {
    expect(stripHiddenIds("<!--timestamp:abc-->")).toBe("<!--timestamp:abc-->");
    expect(stripHiddenIds("<!--edited:-->")).toBe("<!--edited:-->");
  });
});
