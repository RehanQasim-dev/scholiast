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
    onSetColumnWidth: vi.fn(),
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

/** Reading settings live behind the aA popover; open it first. */
function openAppearance() {
  fireEvent.click(
    screen.getByRole("button", { name: "Reading appearance settings" }),
  );
}

describe("ReaderTopBar", () => {
  test("renders back link and title", () => {
    renderBar();
    expect(screen.getByTestId("reader-back")).toHaveAttribute("href", "/home");
    expect(screen.getByText("The Craft of Reading")).toBeInTheDocument();
  });

  test("font buttons fire deltas and disable at clamp bounds", () => {
    const { props, rerender } = renderBar({ fontStep: 0 });
    openAppearance();
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
    openAppearance();
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

  test("column width options live inside the appearance popover", () => {
    const { props } = renderBar({ columnWidth: 736 });
    // Hidden until the popover opens.
    expect(screen.queryByText("Wide")).not.toBeInTheDocument();
    openAppearance();
    // The current width reads as selected; picking another reports it.
    fireEvent.click(screen.getByText("Wide"));
    expect(props.onSetColumnWidth).toHaveBeenCalledWith(800);
  });

  test("delete requires typing DELETE and then calls onDelete once", async () => {
    const onDelete = vi.fn(async () => {});
    renderBar({ onDelete });
    openAppearance();
    fireEvent.click(screen.getByTestId("delete-article-button"));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Delete article/);
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
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  test("cancel and Escape dismiss the dialog without deleting", () => {
    const onDelete = vi.fn(async () => {});
    renderBar({ onDelete });
    openAppearance();
    fireEvent.click(screen.getByTestId("delete-article-button"));
    fireEvent.click(screen.getByTestId("delete-cancel-button"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    openAppearance();
    fireEvent.click(screen.getByTestId("delete-article-button"));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("appearance controls hidden without an article", () => {
    renderBar({ hasArticle: false, title: null });
    expect(
      screen.queryByRole("button", { name: "Reading appearance settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("delete-article-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Reader")).toBeInTheDocument();
  });

  test("tapping away (touch) dismisses the appearance popover", () => {
    renderBar();
    openAppearance();
    expect(screen.getByRole("dialog", { name: "Reading settings" })).toBeInTheDocument();

    fireEvent.touchStart(document.body);
    expect(screen.queryByRole("dialog", { name: "Reading settings" })).not.toBeInTheDocument();
  });

  test("pointer-down away and Escape dismiss the appearance popover", () => {
    renderBar();
    openAppearance();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Reading settings" })).not.toBeInTheDocument();

    openAppearance();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Reading settings" })).not.toBeInTheDocument();
  });

  test("taps inside the popover keep it open", () => {
    renderBar();
    openAppearance();
    const dialog = screen.getByRole("dialog", { name: "Reading settings" });
    fireEvent.touchStart(dialog);
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole("dialog", { name: "Reading settings" })).toBeInTheDocument();
  });
});
