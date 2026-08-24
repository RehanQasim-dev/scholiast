import { createElement, type ReactNode } from "react";

// The single definition of the note/comment markdown subset for the Tauri app,
// ported semantically from extension video-notes.ts + the display pass of
// comment-markdown.ts. A stored note is markdown text carrying hidden sync IDs:
//
//   **bold**                          *italic*
//   [text](https://…)                 bare https://… urls
//   #tag (#tag_name/sub_tag)          <!--timestamp:N-->   (creation id, hidden)
//                                     <!--edited:M-->      (edit stamp → badge)
//
// Parsing is a hand-rolled scanner over the RAW string: nothing here produces
// HTML, so there is no injection surface — every character either becomes part
// of a typed token or stays verbatim text, and rendering goes through React
// elements (which escape). parse → serializeToPlainText reproduces the input
// byte-for-byte; use stripHiddenIds for a clean editor prefill.

export interface NoteTextNode {
  kind: "text";
  value: string;
}

export interface NoteBoldNode {
  kind: "bold";
  children: NoteNode[];
}

export interface NoteItalicNode {
  kind: "italic";
  children: NoteNode[];
}

export interface NoteLinkNode {
  kind: "link";
  href: string;
  label: string;
}

export interface NoteUrlNode {
  kind: "url";
  href: string;
}

export interface NoteTagNode {
  kind: "tag";
  value: string;
}

export interface NoteTimestampIdNode {
  kind: "timestamp-id";
  /** Digits of `<!--timestamp:N-->` — kept as a string (stable sync id). */
  value: string;
}

export interface NoteEditedIdNode {
  kind: "edited-id";
  /** Digits of `<!--edited:M-->`. */
  value: string;
}

export type NoteNode =
  | NoteTextNode
  | NoteBoldNode
  | NoteItalicNode
  | NoteLinkNode
  | NoteUrlNode
  | NoteTagNode
  | NoteTimestampIdNode
  | NoteEditedIdNode;

// Anchors are tried at the scan position in this order; the first match wins.
// Hrefs exclude quotes and angle brackets (stricter than the extension) so a
// crafted url can never smuggle markup into an attribute context.
const ID_RE = /^<!--(timestamp|edited):(\d+)-->/;
const LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)"'<]+)\)/;
const URL_RE = /^https?:\/\/[^\s)"'<]+/;
const TRAILING_PUNCT_RE = /[.,;:?!]+$/;
const BOLD_RE = /^\*\*([^*]+)\*\*/;
const ITALIC_RE = /^\*([^*\s][^*]*?)\*/;
const TAG_RE = /^#[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*/;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;

function parseNodes(md: string): NoteNode[] {
  const nodes: NoteNode[] = [];
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) {
      nodes.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (i < md.length) {
    const rest = md.slice(i);
    const prev = i > 0 ? md[i - 1] : "";

    // Hidden sync ids. Digits-only, mirroring crates/core models.rs — malformed
    // markers fall through and stay visible text, exactly like strip_markers.
    const id = ID_RE.exec(rest);
    if (id) {
      flush();
      nodes.push(
        id[1] === "timestamp"
          ? { kind: "timestamp-id", value: id[2] }
          : { kind: "edited-id", value: id[2] },
      );
      i += id[0].length;
      continue;
    }

    // Markdown links first, so the bare-url pass can't re-link the url inside.
    const link = LINK_RE.exec(rest);
    if (link) {
      flush();
      nodes.push({ kind: "link", href: link[2], label: link[1] });
      i += link[0].length;
      continue;
    }

    // Bare urls need a word boundary before them (extension used `\b`) and give
    // up their trailing punctuation back to the text stream.
    if (!(i > 0 && WORD_CHAR_RE.test(prev))) {
      const url = URL_RE.exec(rest);
      if (url) {
        let href = url[0];
        let consumed = href.length;
        const trailing = TRAILING_PUNCT_RE.exec(href);
        if (trailing) {
          consumed -= trailing[0].length;
          href = href.slice(0, consumed);
        }
        flush();
        nodes.push({ kind: "url", href });
        i += consumed;
        continue;
      }
    }

    // Bold before italic so `**` is never read as two empty italics.
    const bold = BOLD_RE.exec(rest);
    if (bold) {
      flush();
      nodes.push({ kind: "bold", children: parseNodes(bold[1]) });
      i += bold[0].length;
      continue;
    }

    const italic = ITALIC_RE.exec(rest);
    if (italic) {
      flush();
      nodes.push({ kind: "italic", children: parseNodes(italic[1]) });
      i += italic[0].length;
      continue;
    }

    // A tag must start the note or follow whitespace (same rule as the
    // extension's TAG_RE), so mid-word `#` stays plain text.
    if (i === 0 || /\s/.test(prev)) {
      const tag = TAG_RE.exec(rest);
      if (tag) {
        flush();
        nodes.push({ kind: "tag", value: tag[0] });
        i += tag[0].length;
        continue;
      }
    }

    text += md[i];
    i += 1;
  }

  flush();
  return nodes;
}

/**
 * Stored note markdown → typed tokens. Lossless: serializing the result
 * reproduces `md` exactly, including the hidden id markers.
 */
export function parseNoteMarkdown(md: string): NoteNode[] {
  return parseNodes(md);
}

function serializeNode(node: NoteNode): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "bold":
      return `**${node.children.map(serializeNode).join("")}**`;
    case "italic":
      return `*${node.children.map(serializeNode).join("")}*`;
    case "link":
      return `[${node.label}](${node.href})`;
    case "url":
      return node.href;
    case "tag":
      return node.value;
    case "timestamp-id":
      return `<!--timestamp:${node.value}-->`;
    case "edited-id":
      return `<!--edited:${node.value}-->`;
  }
}

/**
 * Tokens → markdown source. The inverse of {@link parseNoteMarkdown}: for any
 * input `md`, `serializeToPlainText(parseNoteMarkdown(md)) === md`.
 */
export function serializeToPlainText(nodes: NoteNode[]): string {
  return nodes.map(serializeNode).join("");
}

const HIDDEN_ID_RE = /<!--(?:timestamp|edited):\d+-->/g;

/** Removes every valid hidden id marker; malformed ones stay verbatim. */
export function stripHiddenIds(md: string): string {
  return md.replace(HIDDEN_ID_RE, "");
}

function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

const TEXT_CLASS = "text-[color:var(--sc-text)]";
const LINK_CLASS =
  "text-[color:var(--sc-accent)] underline underline-offset-2 hover:opacity-80";
const TAG_CLASS =
  "inline-flex items-center rounded-full bg-[color:var(--sc-elevated)] px-1.5 py-px text-xs font-medium text-[color:var(--sc-accent)]";
const EDITED_BADGE_CLASS =
  "ml-1 inline-block rounded bg-[color:var(--sc-elevated)] px-1 py-px align-middle text-[10px] uppercase tracking-wide text-[color:var(--sc-text-3)]";

function renderAnchor(href: string, label: string, key: string): ReactNode {
  const target = safeHref(href);
  if (!target) return createElement("span", { key, className: TEXT_CLASS }, label);
  return createElement(
    "a",
    {
      key,
      href: target,
      target: "_blank",
      rel: "noreferrer",
      className: LINK_CLASS,
    },
    label,
  );
}

function renderNode(node: NoteNode, index: number): ReactNode[] {
  const key = String(index);
  switch (node.kind) {
    case "text": {
      // Newlines become real breaks; every other character stays verbatim.
      const out: ReactNode[] = [];
      node.value.split("\n").forEach((line, lineIndex) => {
        if (lineIndex > 0) out.push(createElement("br", { key: `${key}-br-${lineIndex}` }));
        if (line) {
          out.push(
            createElement(
              "span",
              { key: `${key}-t-${lineIndex}`, className: TEXT_CLASS },
              line,
            ),
          );
        }
      });
      return out;
    }
    case "bold":
      return [
        createElement(
          "strong",
          { key, className: `font-semibold ${TEXT_CLASS}` },
          node.children.map((child, childIndex) => renderNode(child, childIndex)),
        ),
      ];
    case "italic":
      return [
        createElement(
          "em",
          { key, className: "italic" },
          node.children.map((child, childIndex) => renderNode(child, childIndex)),
        ),
      ];
    case "link":
      return [renderAnchor(node.href, node.label, key)];
    case "url":
      return [renderAnchor(node.href, node.href, key)];
    case "tag":
      return [createElement("span", { key, className: TAG_CLASS }, node.value)];
    case "timestamp-id":
      // Creation id: the stable sync key, never shown.
      return [];
    case "edited-id":
      return [createElement("span", { key, className: EDITED_BADGE_CLASS }, "edited")];
  }
}

/**
 * Tokens → React elements. Only sanitized elements come out: text is escaped
 * by React, links are http(s)-only with `target="_blank" rel="noreferrer"`,
 * tags render as pills, `<!--edited:M-->` as a small badge and
 * `<!--timestamp:N-->` invisibly.
 */
export function renderNoteNodes(nodes: NoteNode[]): ReactNode[] {
  return nodes.flatMap((node, index) => renderNode(node, index));
}
