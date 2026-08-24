import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

test("shell renders the sidebar and the home placeholder", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/home"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );

  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  for (const label of ["Home", "Player", "Reader", "Settings"]) {
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      `/${label.toLowerCase()}`
    );
  }
  expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
});
