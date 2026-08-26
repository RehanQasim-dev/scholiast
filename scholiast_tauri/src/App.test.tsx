import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import App from "./App";

function renderApp(initialEntries: string[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

test("shell renders the sidebar and the home placeholder", () => {
  renderApp(["/home"]);

  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  for (const label of ["Home", "Player", "Reader"]) {
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      `/${label.toLowerCase()}`
    );
  }
  expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Scholiast" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
});

describe("responsive shell switch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNarrow(narrow: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }))
    );
  }

  test("narrow viewport swaps the sidebar for bottom tabs", () => {
    stubNarrow(true);
    renderApp(["/home"]);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const tabs = screen.getByTestId("bottom-tabs");
    expect(tabs).toBeInTheDocument();
    for (const label of ["home", "player", "reader", "settings"]) {
      expect(screen.getByTestId(`tab-${label}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("navigation", { name: "Primary" })).toBe(tabs);
  });

  test("wide viewport keeps the sidebar and no bottom tabs", () => {
    stubNarrow(false);
    renderApp(["/home"]);

    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-tabs")).not.toBeInTheDocument();
  });
});
