// Shared client helpers (plain ES module — no build step needed).

import { t } from "/i18n.js";

// --- theme --------------------------------------------------------------------

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sun: svg(
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  ),
  moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
};

/**
 * Wire the #theme-toggle button (if present). The pre-paint script in each
 * page's head already set data-theme from localStorage or the OS preference;
 * this keeps following the OS until the user makes an explicit choice.
 */
export function initTheme() {
  const root = document.documentElement;
  const button = document.getElementById("theme-toggle");
  const media = matchMedia("(prefers-color-scheme: light)");

  function apply(theme) {
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = theme === "dark" ? "#171d26" : "#fffdf8";
    if (changed) window.dispatchEvent(new CustomEvent("mw-theme", { detail: theme }));
    if (!button) return;
    const label = theme === "dark" ? t("nav.switchLight") : t("nav.switchDark");
    button.innerHTML = theme === "dark" ? icons.sun : icons.moon;
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  apply(root.dataset.theme || (media.matches ? "light" : "dark"));

  media.addEventListener("change", (event) => {
    if (!localStorage.getItem("mw-theme")) apply(event.matches ? "light" : "dark");
  });

  button?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("mw-theme", next);
    apply(next);
  });
}

/** Reflect a toggle button's on/off state (styled via [aria-pressed]). */
export function setPressed(id, on) {
  document.getElementById(id)?.setAttribute("aria-pressed", String(on));
}

// --- editor/preview pane split ----------------------------------------------------

/**
 * Make the divider between the editor and preview panes draggable. The split
 * is a percentage stored as a CSS custom property (and in localStorage), so
 * CSS owns the layout. Returns { setOpen } to show/hide the divider when the
 * preview pane toggles.
 */
export function initPaneSplit(main, divider) {
  const KEY = "mw-split";
  const saved = Number(localStorage.getItem(KEY));
  if (saved >= 20 && saved <= 80) main.style.setProperty("--split", `${saved}%`);

  divider.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    divider.setPointerCapture(down.pointerId);
    main.classList.add("dragging");
    const rect = main.getBoundingClientRect();
    const onMove = (move) => {
      const pct = Math.min(80, Math.max(20, ((move.clientX - rect.left) / rect.width) * 100));
      main.style.setProperty("--split", `${pct}%`);
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      main.classList.remove("dragging");
      const current = parseFloat(main.style.getPropertyValue("--split")) || 50;
      localStorage.setItem(KEY, String(Math.round(current)));
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
  });

  return {
    setOpen(open) {
      divider.classList.toggle("hidden", !open);
      main.classList.toggle("split", open);
    },
  };
}

// --- export ---------------------------------------------------------------------

/** Trigger a client-side file download. */
export function downloadFile(filename, text, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "My Meeting Notes" -> "my-meeting-notes.md" */
export function markdownFilename(title) {
  const slug = (title || "untitled")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "untitled"}.md`;
}

// --- view mode (edit / split / read) --------------------------------------------

/**
 * Wire the three-way #mode-switch: edit (editor only), split (editor +
 * preview, draggable divider), read (rendered only, centered). Persists in
 * localStorage; first visit on a narrow screen defaults to read — phones are
 * reading devices first.
 */
export function initViewMode({ main, editorHost, preview, divider, onModeChange }) {
  const KEY = "mw-viewmode";
  const switchEl = document.getElementById("mode-switch");
  const split = initPaneSplit(main, divider);
  let mode = localStorage.getItem(KEY);
  if (!["edit", "split", "read"].includes(mode)) {
    mode = matchMedia("(max-width: 640px)").matches ? "read" : "edit";
  }

  function apply(next, persist = true) {
    mode = next;
    if (persist) localStorage.setItem(KEY, mode);
    main.classList.toggle("mode-read", mode === "read");
    editorHost.classList.toggle("hidden", mode === "read");
    preview.classList.toggle("hidden", mode === "edit");
    split.setOpen(mode === "split");
    for (const btn of switchEl.querySelectorAll("[data-mode]")) {
      btn.setAttribute("aria-checked", String(btn.dataset.mode === mode));
    }
    onModeChange?.(mode);
  }

  for (const btn of switchEl.querySelectorAll("[data-mode]")) {
    btn.addEventListener("click", () => apply(btn.dataset.mode));
  }
  apply(mode, false);

  return { get mode() { return mode; }, apply };
}

// --- editor/preview scroll sync -----------------------------------------------

/**
 * Keep the editor and preview panes vertically in step, in both directions.
 * The rendered HTML's .line-anchor[data-line] blocks map source lines to
 * preview pixels; CodeMirror's line blocks map them to editor pixels; scroll
 * positions interpolate between anchors. A short-lived lock marks which pane
 * is driving so the echoed scroll event doesn't bounce back.
 */
export function initScrollSync(view, preview) {
  let lock = null;
  let lockTimer = null;
  const hold = (which) => {
    lock = which;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => (lock = null), 160);
  };

  const anchors = () =>
    [...preview.querySelectorAll(".line-anchor")].map((el) => ({
      line: Number(el.dataset.line),
      top: el.offsetTop,
    }));

  view.scrollDOM.addEventListener(
    "scroll",
    () => {
      if (lock === "preview" || preview.classList.contains("hidden")) return;
      const list = anchors();
      if (!list.length) return;
      hold("editor");
      const scrollTop = view.scrollDOM.scrollTop;
      const block = view.lineBlockAtHeight(scrollTop);
      const fraction = block.height > 0 ? (scrollTop - block.top) / block.height : 0;
      const lineNo = view.state.doc.lineAt(block.from).number + fraction;
      let a = list[0];
      let b = null;
      for (const item of list) {
        if (item.line <= lineNo) a = item;
        else {
          b = item;
          break;
        }
      }
      let y = a.top;
      if (b && b.line > a.line) y = a.top + ((lineNo - a.line) / (b.line - a.line)) * (b.top - a.top);
      preview.scrollTop = Math.max(0, y - 16);
    },
    { passive: true },
  );

  preview.addEventListener(
    "scroll",
    () => {
      if (lock === "editor") return;
      const list = anchors();
      if (!list.length) return;
      hold("preview");
      const y = preview.scrollTop + 16;
      let a = list[0];
      let b = null;
      for (const item of list) {
        if (item.top <= y) a = item;
        else {
          b = item;
          break;
        }
      }
      let lineNo = a.line;
      if (b && b.top > a.top) lineNo = a.line + ((y - a.top) / (b.top - a.top)) * (b.line - a.line);
      const doc = view.state.doc;
      const whole = Math.min(doc.lines, Math.max(1, Math.floor(lineNo)));
      const block = view.lineBlockAt(doc.line(whole).from);
      view.scrollDOM.scrollTop = Math.max(0, block.top + (lineNo - whole) * block.height);
    },
    { passive: true },
  );
}

// --- mermaid --------------------------------------------------------------------

let mermaidLoading = null;

function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidLoading) {
    mermaidLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/mermaid.min.js";
      script.onload = () => resolve(window.mermaid);
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return mermaidLoading;
}

/**
 * Render any `pre.mermaid` blocks inside `container` (the server renderer
 * emits those for ```mermaid fences). The ~2 MB mermaid bundle is lazy-loaded
 * on first sight of a diagram, themed to match the current mode.
 */
export async function renderMermaidIn(container) {
  const nodes = [...container.querySelectorAll("pre.mermaid")];
  if (!nodes.length) return;
  try {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
    });
    await mermaid.run({ nodes });
  } catch {
    // Syntax errors render mermaid's inline error; load failures leave the code block.
  }
}

export async function api(path, options = {}) {
  const init = { headers: {}, ...options };
  if (init.body && typeof init.body !== "string") {
    init.body = JSON.stringify(init.body);
    init.headers["content-type"] = "application/json";
  }
  const response = await fetch(path, init);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = { ok: false, error: `HTTP ${response.status}` };
  }
  return { status: response.status, ...data };
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function timeAgo(iso) {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return t("time.justNow");
  if (seconds < 3600) return t("time.minutesAgo", { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("time.hoursAgo", { n: Math.floor(seconds / 3600) });
  return t("time.daysAgo", { n: Math.floor(seconds / 86400) });
}

export function wsUrl(params) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const qs = new URLSearchParams(params);
  return `${proto}//${location.host}/ws?${qs}`;
}

export function lineOfIndex(text, index) {
  if (index === null || index === undefined) return null;
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

/**
 * Roster + live presence chips. Agents flash in on their edits and fade
 * after `agentTtlMs` since agents don't hold a connection.
 */
export function makeRoster(container, { agentTtlMs = 12_000 } = {}) {
  const connected = new Map(); // clientId -> {name, color, kind, line}
  const agents = new Map(); // clientId -> {name, color, kind, expires}

  function render() {
    container.replaceChildren();
    const now = Date.now();
    for (const [id, agent] of agents) {
      if (agent.expires < now) agents.delete(id);
    }
    for (const [id, p] of [...connected.entries(), ...agents.entries()]) {
      const chip = el(
        "span",
        { class: `chip${p.kind === "agent" ? " agent" : ""}`, title: p.kind },
        el("span", { class: "dot", style: `background:${p.color}` }),
        p.kind === "agent" ? "🤖 " : "",
        p.name,
        p.line ? el("span", { class: "line-no" }, ` · L${p.line}`) : null,
      );
      chip.dataset.clientId = id;
      container.append(chip);
    }
  }

  setInterval(render, 3000);

  return {
    setRoster(participants) {
      connected.clear();
      for (const p of participants) {
        connected.set(p.clientId, { ...p, line: connected.get(p.clientId)?.line ?? null });
      }
      render();
    },
    presence(p, line) {
      if (p.kind === "agent") {
        agents.set(p.clientId, { ...p, line, expires: Date.now() + agentTtlMs });
      } else if (connected.has(p.clientId)) {
        connected.get(p.clientId).line = line;
      } else {
        connected.set(p.clientId, { ...p, line });
      }
      render();
    },
    leave(clientId) {
      connected.delete(clientId);
      render();
    },
  };
}

/** Render comment threads into a sidebar. Handlers are optional per surface. */
export function renderThreads(container, threads, handlers) {
  container.replaceChildren();
  if (!threads.length) {
    container.append(el("p", { class: "muted small" }, t("editor.noComments")));
    return;
  }
  for (const thread of threads) {
    const messages = thread.messages.map((message) =>
      el(
        "div",
        { class: "msg" },
        el("span", { class: "author" }, message.authorName),
        el("span", { class: "when" }, timeAgo(message.createdAt)),
        el("div", {}, message.body),
      ),
    );
    const actions = [];
    if (handlers.onReply) {
      actions.push(el("button", { onclick: () => handlers.onReply(thread) }, t("editor.reply")));
    }
    if (handlers.onResolve) {
      actions.push(
        el(
          "button",
          { onclick: () => handlers.onResolve(thread) },
          thread.resolved ? t("editor.reopen") : t("editor.resolve"),
        ),
      );
    }
    if (handlers.onDelete) {
      actions.push(el("button", { class: "danger", onclick: () => handlers.onDelete(thread) }, t("list.delete")));
    }
    container.append(
      el(
        "div",
        { class: `thread${thread.resolved ? " resolved" : ""}` },
        el(
          "div",
          {
            class: "quote",
            title: t("editor.jumpToText"),
            onclick: () => handlers.onJump?.(thread),
          },
          thread.anchor.quote.slice(0, 160),
        ),
        messages,
        el("div", { class: "actions" }, actions),
      ),
    );
  }
}

// --- instance identity ------------------------------------------------------------

/**
 * Apply instance identity from /api/viewer's `instance` object: branded name
 * in the topbar/title, the software attribution footer (#attribution), and
 * the operator banner (#instance-banner). Pass a pre-fetched viewer response
 * when the page already has one; otherwise this fetches it.
 */
export async function applyInstance(viewer) {
  const v = viewer || (await api("/api/viewer"));
  const instance = v?.instance;
  if (!instance) return null;

  if (instance.branded) {
    for (const brand of document.querySelectorAll("[data-brand]")) {
      brand.textContent = instance.name;
    }
    if (document.title === instance.software.name) document.title = instance.name;
  }

  const attribution = document.getElementById("attribution");
  if (attribution) {
    const link = el("a", { href: instance.software.url }, instance.software.name);
    attribution.replaceChildren("runs ", link, ` ${instance.software.version}`);
  }

  const banner = document.getElementById("instance-banner");
  if (banner && instance.bannerHtml) {
    banner.innerHTML = instance.bannerHtml;
    banner.hidden = false;
  }
  return instance;
}
