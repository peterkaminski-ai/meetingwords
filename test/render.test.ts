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
