import { bindEditor } from "/editor-cm.js";
import { initI18n, t } from "/i18n.js";
import { api, applyInstance, debounce, downloadFile, el, initScrollSync, initTheme, initViewMode, lineOfIndex, makeRoster, markdownFilename, renderMermaidIn, renderThreads, setPressed, wsUrl } from "/ui.js";

initI18n();
initTheme();

const LINENOS_KEY = "mw-linenos";

const shareId = location.pathname.split("/").pop();
const reader = document.getElementById("reader");
const editorShell = document.getElementById("editor-shell");
const editorHost = document.getElementById("source");
const statusDot = document.getElementById("status");
const threadsBox = document.getElementById("threads");
const sidebar = document.getElementById("sidebar");
const preview = document.getElementById("preview");

let access = "none";
let brandName = "MeetingWords";
let currentTitle = "";
let guestName = null;
let threads = [];
let handle = null;

const roster = makeRoster(document.getElementById("roster"));

async function boot() {
  const state = await api(`/api/share/${shareId}`);
  if (!state.ok) {
    document.getElementById("not-found").classList.remove("hidden");
    return;
  }
  access = state.doc.shareAccess;
  threads = state.threads || [];
  setTitle(state.doc.title);

  const viewer = await api("/api/viewer");
  const instance = await applyInstance(viewer);
  if (instance?.branded) {
    brandName = instance.name;
    if (currentTitle) setTitle(currentTitle);
  }
  guestName = viewer.guestName;
  updateNameUi();
  initSaveRibbon(instance);

  if (access === "edit") {
    if (!guestName) await askName();
    startEditor();
  } else {
    startReader();
  }
  if (access !== "view") {
    document.getElementById("toggle-comments").classList.remove("hidden");
    drawThreads();
  }
}

// The save ribbon exists only where a front desk does (frontdeskUrl: "" =
// same origin, a string = its base URL, null = none). The POST goes to the
// front desk, not this instance — the core never sees the email.
function initSaveRibbon(instance) {
  const base = instance?.frontdeskUrl;
  if (base === null || base === undefined) return;
  if (sessionStorage.getItem(`mw-save-dismissed:${shareId}`)) return;
  const ribbon = document.getElementById("save-ribbon");
  const form = document.getElementById("save-form");
  ribbon.hidden = false;
  document.getElementById("save-dismiss").addEventListener("click", () => {
    sessionStorage.setItem(`mw-save-dismissed:${shareId}`, "1");
    ribbon.hidden = true;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("save-email").value.trim();
    if (!email) return;
    try {
      const response = await fetch(`${base}/desk/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, shareId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      form.classList.add("hidden");
      document.getElementById("save-sent").classList.remove("hidden");
    } catch {
      alert(t("save.error"));
    }
  });
}

function setTitle(title) {
  currentTitle = title;
  document.getElementById("doc-title").textContent = title;
  document.title = `${title} — ${brandName}`;
}

function updateNameUi() {
  document.getElementById("viewer-name").textContent = guestName || "";
  document.getElementById("set-name").classList.toggle("hidden", access === "view" || Boolean(guestName));
}

async function askName() {
  const dialog = document.getElementById("name-dialog");
  const input = document.getElementById("name-input");
  input.value = guestName || "";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      async () => {
        const name = input.value.trim();
        if (name) {
          const result = await api(`/api/share/${shareId}/identity`, { method: "POST", body: { name } });
          if (result.ok) guestName = result.guestName;
        }
        updateNameUi();
        resolve();
      },
      { once: true },
    );
    dialog.showModal();
  });
}

document.getElementById("download-md").addEventListener("click", async () => {
  const title = document.getElementById("doc-title").textContent;
  if (handle) {
    downloadFile(markdownFilename(title), handle.session.text);
    return;
  }
  const state = await api(`/api/share/${shareId}`);
  if (state.ok) downloadFile(markdownFilename(title), state.doc.markdown);
});

document.getElementById("set-name").addEventListener("click", async () => {
  await askName();
  // Presence name is fixed at connect; reconnect to pick it up.
  if (handle) location.reload();
});

document.getElementById("toggle-comments").addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
  setPressed("toggle-comments", !sidebar.classList.contains("hidden"));
  if (access !== "edit") {
    // Reader surfaces show threads in an overlay sidebar next to content.
    sidebar.classList.toggle("reader-sidebar");
  }
});

// --- view / comment: rendered reader -----------------------------------------

const refreshReader = debounce(async () => {
  const result = await api(`/api/share/${shareId}/rendered`);
  if (result.ok) {
    reader.innerHTML = result.html;
    renderMermaidIn(reader);
  }
}, 300);

// Re-render on theme switch so mermaid diagrams pick up the matching theme.
window.addEventListener("mw-theme", () => {
  if (!reader.classList.contains("hidden")) refreshReader();
  if (!preview.classList.contains("hidden")) refreshEditPreview();
});

function startReader() {
  reader.classList.remove("hidden");
  if (access !== "view") {
    // Reader pages keep the sidebar visible for comments.
    document.querySelector(".editor-shell").classList.add("hidden");
    document.body.append(sidebar);
    sidebar.style.position = "fixed";
    sidebar.style.right = "0";
    sidebar.style.top = "53px";
    sidebar.style.height = "calc(100vh - 53px)";
  }
  refreshReader();

  // Live updates without edit rights: a lightweight socket that listens for
  // "updated" / "threads-updated" and re-renders.
  const ws = new WebSocket(wsUrl({ shareId }));
  ws.addEventListener("open", () => {
    statusDot.className = "status-dot connected";
    setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
  });
  ws.addEventListener("close", () => {
    statusDot.className = "status-dot disconnected";
    setTimeout(() => location.reload(), 5000);
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data === "pong") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "updated") refreshReader();
    if (message.type === "threads-updated") loadThreads();
    if (message.type === "roster") roster.setRoster(message.participants);
    if (message.type === "hello") setTitle(message.title);
  });

  if (access !== "view") {
    document.getElementById("comment-selection").addEventListener("click", commentOnReaderSelection);
  }
}

async function commentOnReaderSelection() {
  if (!guestName) await askName();
  if (!guestName) return;
  const selection = String(window.getSelection() || "").trim();
  if (!selection) {
    alert(t("editor.selectSomeText"));
    return;
  }
  const body = prompt(t("editor.commentPrompt", { quote: selection.slice(0, 120) }));
  if (!body) return;
  const result = await api(`/api/share/${shareId}/threads`, {
    method: "POST",
    body: { quote: selection, body },
  });
  if (!result.ok) alert(result.error || "Could not add comment.");
}

// --- edit: full collaborative editor -------------------------------------------

function startEditor() {
  editorShell.classList.remove("hidden");
  document.getElementById("mode-switch").classList.remove("hidden");
  document.getElementById("toggle-linenos").classList.remove("hidden");
  const linenosOn = localStorage.getItem(LINENOS_KEY) === "1";
  setPressed("toggle-linenos", linenosOn);

  handle = bindEditor(editorHost, wsUrl({ shareId }), {
    onText: () => refreshEditPreview(),
    onTitle: (title) => setTitle(title),
    onStatus: (status) => {
      statusDot.className = `status-dot ${status}`;
    },
    onRoster: (participants) => roster.setRoster(participants),
    onPresence: (p) => roster.presence(p, lineOfIndex(handle.session.text, p.index)),
    onPresenceLeave: (clientId) => roster.leave(clientId),
    onThreadsUpdated: () => loadThreads(),
  }, { lineNumbers: linenosOn });

  // Console/debug affordance (agents driving a browser use it too).
  window.mf = { handle };

  initScrollSync(handle.view, preview);
  preview.classList.toggle("show-linenos", linenosOn);

  initViewMode({
    main: document.querySelector(".editor-main"),
    editorHost,
    preview,
    divider: document.getElementById("pane-divider"),
    onModeChange: (mode) => {
      if (mode !== "edit") refreshEditPreview();
    },
  });

  document.getElementById("toggle-linenos").addEventListener("click", () => {
    const on = localStorage.getItem(LINENOS_KEY) !== "1";
    localStorage.setItem(LINENOS_KEY, on ? "1" : "0");
    handle.setLineNumbers(on);
    preview.classList.toggle("show-linenos", on);
    setPressed("toggle-linenos", on);
  });

  document.getElementById("comment-selection").addEventListener("click", async () => {
    if (!guestName) await askName();
    if (!guestName) return;
    const { from: start, to: end } = handle.selection();
    if (start === end) {
      alert(t("editor.selectSomeText"));
      return;
    }
    const text = handle.session.text;
    const body = prompt(t("editor.commentPrompt", { quote: text.slice(start, Math.min(end, start + 120)) }));
    if (!body) return;
    await api(`/api/share/${shareId}/threads`, {
      method: "POST",
      body: {
        anchor: {
          quote: text.slice(start, end),
          prefix: text.slice(Math.max(0, start - 32), start),
          suffix: text.slice(end, end + 32),
          start,
          end,
        },
        body,
      },
    });
    sidebar.classList.remove("hidden");
    setPressed("toggle-comments", true);
  });
}

const refreshEditPreview = debounce(async () => {
  if (preview.classList.contains("hidden")) return;
  const result = await api(`/api/share/${shareId}/rendered`);
  if (result.ok) {
    preview.innerHTML = result.html;
    renderMermaidIn(preview);
  }
}, 400);

// --- threads (shared by both surfaces) --------------------------------------------

async function loadThreads() {
  const result = await api(`/api/share/${shareId}`);
  if (result.ok) {
    threads = result.threads || [];
    drawThreads();
  }
}

function drawThreads() {
  renderThreads(threadsBox, threads, {
    onJump:
      access === "edit"
        ? (thread) => {
            const at = (handle?.session.text || "").indexOf(thread.anchor.quote);
            if (at !== -1) handle.select(at, at + thread.anchor.quote.length);
          }
        : undefined,
    onReply: async (thread) => {
      if (!guestName) await askName();
      if (!guestName) return;
      const body = prompt(t("editor.replyPrompt"));
      if (!body) return;
      await api(`/api/share/${shareId}/threads/${thread.id}/replies`, { method: "POST", body: { body } });
    },
    onResolve: async (thread) => {
      const result = await api(`/api/share/${shareId}/threads/${thread.id}`, {
        method: "PATCH",
        body: { resolved: !thread.resolved },
      });
      if (!result.ok) alert(result.error || "Not allowed.");
    },
  });
}

boot();
