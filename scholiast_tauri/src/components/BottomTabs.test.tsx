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
  test("renders the three primary destinations", () => {
    renderTabs(["/home"]);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-testid", "bottom-tabs");
    // Study surfaces (Player/Reader) hide the chrome; only the three
    // library-level destinations live here.
    for (const label of ["Home", "Library", "Settings"]) {
      expect(screen.getByTestId(`tab-${label.toLowerCase()}`)).toHaveTextContent(
        label,
      );
    }
    expect(screen.queryByTestId("tab-player")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-reader")).not.toBeInTheDocument();
  });

  test("marks the active route", () => {
    renderTabs(["/library"]);
    expect(screen.getByTestId("tab-library")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("tab-home")).not.toHaveAttribute("aria-current");
  });

  test("active state follows the current route", () => {
    renderTabs(["/settings"]);
    expect(screen.getByTestId("tab-settings")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
