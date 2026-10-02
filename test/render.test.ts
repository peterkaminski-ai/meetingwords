import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render";

describe("YAML frontmatter rendering", () => {
  const DOC = `---
name: meetingwords
description: Use when given a share link (https://<host>/s/<id>).
---

# Title

Body text.
`;

  it("renders a leading frontmatter block as a yaml code block", () => {
    const html = renderMarkdown(DOC);
    expect(html).toContain('class="hljs language-yaml frontmatter"');
    expect(html).not.toContain("<h2"); // `---` must not become a setext heading
  });

  it("preserves angle-bracket placeholders inside frontmatter", () => {
    const html = renderMarkdown(DOC);
    expect(html).toContain("&lt;host&gt;");
    expect(html).toContain("&lt;id&gt;");
  });

  it("keeps line anchors counting through the frontmatter", () => {
    const html = renderMarkdown(DOC);
    expect(html).toContain('data-line="1"'); // the frontmatter block itself
    expect(html).toContain('data-line="6"'); // # Title sits on source line 6
  });

  it("leaves mid-document --- alone", () => {
    const html = renderMarkdown("Text.\n\n---\n\nMore.\n");
    expect(html).toContain("<hr");
    expect(html).not.toContain("language-yaml");
  });

  it("leaves an unclosed leading --- alone", () => {
    const html = renderMarkdown("---\n\nJust a rule, no closing fence.\n");
    expect(html).toContain("<hr");
    expect(html).not.toContain("language-yaml");
  });
});

describe("links in rendered documents", () => {
  const REL = 'rel="nofollow noopener noreferrer ugc"';

  it("marks inline, autolinked and reference-style links as user-generated", () => {
    const html = renderMarkdown(
      "An [inline](https://example.com/a) link, a bare https://example.org/b one, and a [reference][r].\n\n[r]: https://example.net/c\n",
    );
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html.match(new RegExp(REL, "g"))).toHaveLength(3);
  });

  it("replaces a rel the author wrote in raw HTML", () => {
    const html = renderMarkdown('<a href="https://example.com/" rel="dofollow">x</a>');
    expect(html).toContain(REL);
    expect(html).not.toContain("dofollow");
  });
});

describe("strikethrough follows GFM flanking", () => {
  it("leaves approximate-number tildes alone", () => {
    const html = renderMarkdown("Intro (~5 min): a round-robin, then go back to edit. Demo (~3–5 min): agents working together.");
    expect(html).not.toContain("<del>");
    expect(html).toContain("(~5 min)");
    expect(html).toContain("(~3–5 min)");
  });

  it("leaves them alone inside a table cell", () => {
    const html = renderMarkdown("| Step | Time |\n|---|---|\n| Intro (~5 min), demo (~3 min) | ~8 min |\n");
    expect(html).not.toContain("<del>");
  });

  it("still strikes real single- and double-tilde spans", () => {
    expect(renderMarkdown("a ~strike~ b")).toContain("a <del>strike</del> b");
    expect(renderMarkdown("a ~~strike~~ b")).toContain("a <del>strike</del> b");
    expect(renderMarkdown("done (~finally~).")).toContain("(<del>finally</del>).");
  });

  it("skips a tilde that can't close and pairs with the next that can", () => {
    expect(renderMarkdown("~about (~3 of them~ left")).toContain("<del>about (~3 of them</del> left");
  });
});
