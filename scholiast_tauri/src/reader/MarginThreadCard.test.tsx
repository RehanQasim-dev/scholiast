import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import MarginThreadCard from "./MarginThreadCard";
import type { ThreadCommentView } from "./ThreadCard";
import type { ThreadEntry } from "./useThreadModel";

function comment(
  id: string,
  body: string,
  createdAt = 1000,
): ThreadCommentView {
  return {
    highlightId: "m1",
    id,
    note: `${body}<!--timestamp:${id}-->`,
    createdAt,
    editedAt: null,
  };
}

function entry(notes: ThreadCommentView[]): ThreadEntry {
  return {
    key: "m1",
    members: [
      {
        type: "text",
        id: "m1",
        content: "Quoted source sentence.",
        notes: notes.map((n) => n.note),
        color: "yellow",
      },
    ],
    comments: notes,
  };
}

const baseProps = {
  active: true,
  lastSyncedAt: null as number | null,
  lastMutationAt: null as number | null,
  isTablet: false,
  onSelect: vi.fn(),
  onClearThread: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
};

describe("MarginThreadCard", () => {
  test("quoteless: replies render without the highlight quote", () => {
    render(
      <MarginThreadCard
        {...baseProps}
        entry={entry([comment("1000", "First reply")])}
      />,
    );
    expect(screen.getByText("First reply")).toBeInTheDocument();
    expect(screen.queryByText("Quoted source sentence.")).not.toBeInTheDocument();
  });

  test("desktop icon buttons edit and delete a single reply", () => {
    const onEditComment = vi.fn();
    const onDeleteComment = vi.fn();
    render(
      <MarginThreadCard
        {...baseProps}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        entry={entry([comment("1000", "First reply")])}
      />,
    );
    fireEvent.click(screen.getByTestId("margin-delete-comment-1000"));
    expect(onDeleteComment).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("margin-edit-comment-1000"));
    const box = screen.getByLabelText("Edit comment") as HTMLTextAreaElement;
    expect(box.value).toBe("First reply");
    fireEvent.change(box, { target: { value: "Edited" } });
    fireEvent.click(screen.getByTestId("save-margin-comment-edit"));
    expect(onEditComment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1000" }),
      "Edited",
    );
  });

  test("thread trash shows only with 2+ replies and clears the thread", () => {
    const onClearThread = vi.fn();
    const { rerender } = render(
      <MarginThreadCard
        {...baseProps}
        onClearThread={onClearThread}
        entry={entry([comment("1000", "Only reply")])}
      />,
    );
    expect(screen.queryByTestId("margin-thread-delete")).not.toBeInTheDocument();

    rerender(
      <MarginThreadCard
        {...baseProps}
        onClearThread={onClearThread}
        entry={entry([comment("1000", "One"), comment("2000", "Two")])}
      />,
    );
    fireEvent.click(screen.getByTestId("margin-thread-delete"));
    expect(onClearThread).toHaveBeenCalledTimes(1);
  });

  test("tablet hides per-reply icon buttons; sync dot reflects sync state", () => {
    const { rerender } = render(
      <MarginThreadCard
        {...baseProps}
        isTablet
        lastSyncedAt={5000}
        lastMutationAt={null}
        entry={entry([comment("1000", "Synced reply", 1000)])}
      />,
    );
    expect(
      screen.queryByTestId("margin-edit-comment-1000"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("margin-delete-comment-1000"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("margin-sync-1000")).toHaveAttribute(
      "data-synced",
      "true",
    );

    rerender(
      <MarginThreadCard
        {...baseProps}
        isTablet
        lastSyncedAt={5000}
        lastMutationAt={6000}
        entry={entry([comment("1000", "Synced reply", 1000)])}
      />,
    );
    expect(screen.getByTestId("margin-sync-1000")).not.toHaveAttribute(
      "data-synced",
    );
  });
});
