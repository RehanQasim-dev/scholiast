import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, vi } from "vitest";
import App from "./App";

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function renderApp(initialEntries: string[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

test("shell renders the sidebar with library-level destinations", () => {
  renderApp(["/home"]);

  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  for (const [label, href] of [
    ["Home", "/home"],
    ["Library", "/library"],
    ["Settings", "/settings"],
  ] as const) {
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  }
  expect(
    within(screen.getByRole("complementary")).getByText("Scholiast"),
  ).toBeInTheDocument();
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
    for (const label of ["home", "library", "settings"]) {
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

  test("study sessions hide all chrome on every viewport", () => {
    stubNarrow(false);
    renderApp(["/reader"]);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-tabs")).not.toBeInTheDocument();
  });
});
