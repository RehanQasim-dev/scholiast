import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BottomTabs from "./BottomTabs";

function renderTabs(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <BottomTabs />
    </MemoryRouter>,
  );
}

describe("BottomTabs", () => {
  test("renders the four primary destinations", () => {
    renderTabs(["/home"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-testid", "bottom-tabs");
    for (const label of ["Home", "Player", "Reader", "Settings"]) {
      expect(screen.getByTestId(`tab-${label.toLowerCase()}`)).toHaveTextContent(
        label,
      );
    }
  });

  test("marks the active route", () => {
    renderTabs(["/player"]);
    expect(screen.getByTestId("tab-player")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("tab-home")).not.toHaveAttribute("aria-current");
  });

  test("active state follows the current route", () => {
    renderTabs(["/reader"]);
    expect(screen.getByTestId("tab-reader")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
