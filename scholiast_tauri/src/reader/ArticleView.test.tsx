import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import ArticleView from "./ArticleView";

const fixture = `
  <h2>Why anchors drift</h2>
  <p>Intro paragraph with <a href="https://example.com/a">a link</a> inside.</p>
  <figure><img src="https://example.com/plot.png" alt="Latency plot" /><figcaption>Fig 1</figcaption></figure>
  <blockquote><p>Quoted wisdom stands apart.</p></blockquote>
  <pre><code>const x = 1;</code></pre>
`;

describe("ArticleView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders title header, byline and the fixture article structure", () => {
    render(<ArticleView title="Deep Dive" byline="Ada Lovelace" body={fixture} />);

    expect(screen.getByRole("heading", { name: "Deep Dive" })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Why anchors drift" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "a link" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getByText("Quoted wisdom stands apart.")).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "Latency plot" });
    expect(img).toHaveAttribute("loading", "lazy");
  });

  test("applies font-step, serif and column-width from props (defaults 0 / false / 736)", () => {
    const plain = render(<ArticleView title="T" body="<p>Hi</p>" />);
    const plainRoot = plain.container.querySelector<HTMLElement>(".sc-article")!;
    expect(plainRoot.style.getPropertyValue("--reader-font-step")).toBe("0");
    expect(plainRoot.style.getPropertyValue("--sc-article-width")).toBe("736px");
    expect(plainRoot.classList.contains("sc-article--serif")).toBe(false);
    plain.unmount();

    const styled = render(
      <ArticleView title="T" body="<p>Hi</p>" fontStep={2} serif columnWidth={640} />,
    );
    const styledRoot = styled.container.querySelector<HTMLElement>(".sc-article")!;
    expect(styledRoot.style.getPropertyValue("--reader-font-step")).toBe("2");
    expect(styledRoot.style.getPropertyValue("--sc-article-width")).toBe("640px");
    expect(styledRoot.classList.contains("sc-article--serif")).toBe(true);
  });

  test("a failed image swaps to a broken-image chip carrying its alt text", () => {
    const { container } = render(
      <ArticleView
        title="T"
        body='<p>Before</p><img src="https://example.com/x.png" alt="Broken plot" />'
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Broken plot" }));

    const chip = container.querySelector('[data-testid="broken-image-chip"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("Broken plot");
    expect(container.querySelector("img")).toBeNull();
  });

  test("dirty fixture leaves no script node or handlers in the DOM and warns in dev", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dirty =
      '<p>safe text survives</p><script>window.__xss = true;</script>' +
      '<img src="x.png" alt="X" onerror="window.__xss = true" />' +
      '<a href="javascript:window.__xss=true">bad link</a>';
    const { container } = render(<ArticleView title="T" body={dirty} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    // href stripped → the anchor loses its link role; assert via text instead.
    const badLink = screen.getByText("bad link");
    expect(badLink).not.toHaveAttribute("href");
    expect(screen.getByText("safe text survives")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("<script"));
  });

  test("empty body shows capture-pending copy; notReadable swaps it", () => {
    const first = render(
      <ArticleView
        title={null}
        body={null}
        footerAction={<a href="/home">Back to Home</a>}
      />,
    );
    expect(
      screen.getByText("Capture pending — extraction lands in the next wave"),
    ).toBeInTheDocument();
    expect(screen.getByText("Back to Home")).toBeInTheDocument();
    first.unmount();

    render(<ArticleView title={null} body={null} notReadable />);
    expect(
      screen.getByText(/couldn't be extracted as readable text/),
    ).toBeInTheDocument();
  });
});
