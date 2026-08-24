import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SwatchPopup from "./SwatchPopup";

describe("SwatchPopup", () => {
  test("renders three color circles and a comment button", () => {
    render(
      <SwatchPopup
        anchor={{ top: 100, left: 200 }}
        onPickColor={vi.fn()}
        onComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swatch-yellow")).toBeInTheDocument();
    expect(screen.getByTestId("swatch-red")).toBeInTheDocument();
    expect(screen.getByTestId("swatch-green")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comment/i })).toBeInTheDocument();
  });

  test("color clicks report the picked color; 💬 reports a comment", () => {
    const onPickColor = vi.fn();
    const onComment = vi.fn();
    render(
      <SwatchPopup
        anchor={{ top: 0, left: 0 }}
        onPickColor={onPickColor}
        onComment={onComment}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("swatch-green"));
    expect(onPickColor).toHaveBeenCalledWith("green");
    fireEvent.click(screen.getByTestId("swatch-comment"));
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  test("Escape and outside mousedown dismiss it; inside mousedown does not", () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <SwatchPopup
          anchor={{ top: 0, left: 0 }}
          onPickColor={vi.fn()}
          onComment={vi.fn()}
          onClose={onClose}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.mouseDown(screen.getByTestId("swatch-popup"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("highlights use the shared highlight token vars", () => {
    render(
      <SwatchPopup
        anchor={{ top: 0, left: 0 }}
        onPickColor={vi.fn()}
        onComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swatch-yellow")).toHaveStyle({
      backgroundColor: "var(--sc-hl-yellow)",
    });
    expect(screen.getByTestId("swatch-red")).toHaveStyle({
      backgroundColor: "var(--sc-hl-red)",
    });
    expect(screen.getByTestId("swatch-green")).toHaveStyle({
      backgroundColor: "var(--sc-hl-green)",
    });
  });
});
