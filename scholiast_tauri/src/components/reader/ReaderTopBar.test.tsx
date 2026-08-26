import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import ReaderTopBar from "./ReaderTopBar";

function renderBar(
  overrides: Partial<Parameters<typeof ReaderTopBar>[0]> = {},
) {
  const props = {
    title: "The Craft of Reading",
    hasArticle: true,
    fontStep: 0,
    serif: false,
    columnWidth: 736,
    onFontStep: vi.fn(),
    onToggleSerif: vi.fn(),
    onCycleColumnWidth: vi.fn(),
    onDelete: vi.fn(async () => {}),
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <ReaderTopBar {...props} />
    </MemoryRouter>,
  );
  return { props, ...view };
}

describe("ReaderTopBar", () => {
  test("renders breadcrumb with library link and title", () => {
    renderBar();
    expect(screen.getByTestId("breadcrumb-library")).toHaveAttribute(
      "href",
      "/reader",
    );
    expect(screen.getByText("The Craft of Reading")).toBeInTheDocument();
  });

  test("font buttons fire deltas and disable at clamp bounds", () => {
    const { props, rerender } = renderBar({ fontStep: 0 });
    fireEvent.click(screen.getByTestId("font-step-up"));
    expect(props.onFontStep).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByTestId("font-step-down"));
    expect(props.onFontStep).toHaveBeenLastCalledWith(-1);
    expect(screen.getByTestId("font-step-up")).toBeEnabled();

    rerender(
      <MemoryRouter>
        <ReaderTopBar {...props} fontStep={4} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("font-step-up")).toBeDisabled();
    expect(screen.getByTestId("font-step-down")).toBeEnabled();

    rerender(
      <MemoryRouter>
        <ReaderTopBar {...props} fontStep={-2} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("font-step-down")).toBeDisabled();
    expect(screen.getByTestId("font-step-up")).toBeEnabled();
  });

  test("serif toggle reflects state and reports clicks", () => {
    const { props, rerender } = renderBar({ serif: false });
    fireEvent.click(screen.getByTestId("serif-toggle"));
    expect(props.onToggleSerif).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("serif-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(
      <MemoryRouter>
        <ReaderTopBar {...props} serif />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("serif-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("column width control is an icon button and reveals value only inside sheet", () => {
    const { props } = renderBar({ columnWidth: 800 });
    const btn = screen.getByTestId("column-width-cycle");
    expect(btn).not.toHaveTextContent("800px");
    expect(btn).toHaveAttribute("aria-label", expect.stringContaining("800"));
    fireEvent.click(btn);
    expect(screen.getByTestId("width-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("width-sheet")).toHaveTextContent("800px");
    expect(props.onCycleColumnWidth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("736"));
    expect(props.onCycleColumnWidth).toHaveBeenCalled();
  });

  test("delete requires typing DELETE and then calls onDelete once", async () => {
    const onDelete = vi.fn(async () => {});
    renderBar({ onDelete });
    fireEvent.click(screen.getByTestId("delete-article-button"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Delete this article/);
    expect(dialog).toHaveTextContent(/The Craft of Reading/);

    const confirmButton = screen.getByTestId("delete-confirm-button");
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-confirm-input"), {
      target: { value: "delete " },
    });
    expect(confirmButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("cancel and Escape dismiss the dialog without deleting", () => {
    const onDelete = vi.fn(async () => {});
    renderBar({ onDelete });
    fireEvent.click(screen.getByTestId("delete-article-button"));
    fireEvent.click(screen.getByTestId("delete-cancel-button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("delete-article-button"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("sync chip placeholder renders and delete button hidden without an article", () => {
    renderBar({ hasArticle: false, title: null });
    expect(screen.getByTestId("sync-chip")).toBeInTheDocument();
    expect(
      screen.queryByTestId("delete-article-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
  });
});
