import hljs from "highlight.js";
import { marked, Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";

// Server-side markdown rendering: GFM via marked, code highlighting via
// highlight.js, mermaid blocks passed through for client-side rendering,
// then a sanitize-html pass so rendered shared docs can't smuggle script.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const renderer = new Renderer();
renderer.code = ({ text, lang }: Tokens.Code) => {
  const language = (lang || "").trim().split(/\s+/)[0];
  if (language === "mermaid") {
    return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
  }
  const valid = language && hljs.getLanguage(language) ? language : null;
  const body = valid ? hljs.highlight(text, { language: valid }).value : escapeHtml(text);
  const cls = valid ? `hljs language-${escapeHtml(valid)}` : "hljs";
  return `<pre><code class="${cls}">${body}</code></pre>`;
};

marked.setOptions({ gfm: true, breaks: true, renderer });

// Strikethrough the way GitHub does it. marked pairs any two tildes, so
// "(~5 min) ... (~3 min)" comes out struck through from the first to the
// second. GFM only lets a tilde run close a strikethrough if it is
// right-flanking: not preceded by whitespace, and if preceded by punctuation
// then followed by whitespace, punctuation or the end. The "~" in "(~3" has
// "(" before it and a digit after, so it can't close. This scans for the
// first run that can, instead of taking the first run it finds.
const SPACE = /\s/;
const PUNCT = /[\p{P}\p{S}]/u;
marked.use({
  tokenizer: {
    del(src: string) {
      const open = /^(~~?)(?=[^\s~])/.exec(src);
      if (!open) return undefined;
      const fence = open[1].length;
      for (let i = fence; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] !== "~") continue;
        let end = i;
        while (src[end] === "~") end++;
        const before = src[i - 1];
        const after = src[end] ?? "";
        const closes =
          end - i === fence &&
          i > fence &&
          !SPACE.test(before) &&
          (!PUNCT.test(before) || after === "" || SPACE.test(after) || PUNCT.test(after));
        if (closes) {
          const text = src.slice(fence, i);
          return { type: "del", raw: src.slice(0, end), text, tokens: this.lexer.inlineTokens(text) };
        }
        i = end - 1;
      }
      return undefined;
    },
  },
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "input", "del", "ins", "sup", "sub"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["class"],
    a: ["href", "name", "target", "rel"],
    div: ["class", "data-line"],
    img: ["src", "alt", "title"],
    input: ["type", "checked", "disabled"],
    code: ["class"],
    span: ["class", "style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // highlight.js emits inline color spans only via classes; permit no styles.
  allowedStyles: {},
  // Every link in a document is one a visitor wrote. nofollow + ugc take
  // away the reason to spam a public pad with links; noopener + noreferrer
  // keep the linked page from reaching back into the pad or learning its
  // URL, which for a share link is the credential. Set here, in the
  // sanitizer, so no markdown path can produce a link without it, and an
  // author's own rel is replaced rather than trusted.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer ugc" }),
  },
};

// YAML frontmatter: a `---` fence on the very first line, closed by a later
// `---` line (the gray-matter/Jekyll rule). Rendered as a highlighted yaml
// code block — treating it as markdown turns `--- ` into headings/rules and
// lets the sanitizer eat placeholder text like <host>.
const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/**
 * Render markdown to sanitized HTML. Each top-level block is wrapped in
 * <div class="line-anchor" data-line="N"> carrying its 1-based source line —
 * the hooks for the rendered view's line numbers and editor/preview scroll
 * sync. Invisible unless the client styles them.
 */
export function renderMarkdown(markdown: string): string {
  let line = 1;
  let html = "";
  const fm = FRONTMATTER_RE.exec(markdown);
  if (fm) {
    const body = hljs.highlight(fm[1], { language: "yaml" }).value;
    html += `<div class="line-anchor" data-line="1"><pre><code class="hljs language-yaml frontmatter">${body}</code></pre></div>`;
    line += (fm[0].match(/\n/g) || []).length;
    markdown = markdown.slice(fm[0].length);
  }
  const tokens = marked.lexer(markdown);
  for (const token of tokens) {
    const raw: string = token.raw ?? "";
    // Reference-link definitions live on the lexer result; parser needs them.
    const single = Object.assign([token], { links: tokens.links });
    const rendered = marked.parser(single, { async: false });
    if (token.type !== "space" && rendered.trim()) {
      html += `<div class="line-anchor" data-line="${line}">${rendered}</div>`;
    } else {
      html += rendered;
    }
    line += (raw.match(/\n/g) || []).length;
  }
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
