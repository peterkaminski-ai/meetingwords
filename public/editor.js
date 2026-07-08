import { bindEditor } from "/editor-cm.js";
import { initI18n, t } from "/i18n.js";
import { api, applyInstance, debounce, downloadFile, el, initScrollSync, initTheme, initViewMode, lineOfIndex, makeRoster, markdownFilename, renderMermaidIn, renderThreads, setPressed, wsUrl } from "/ui.js";

initI18n();
initTheme();
applyInstance();

const LINENOS_KEY = "mw-linenos";
const linenosOn = localStorage.getItem(LINENOS_KEY) === "1";

const docId = location.pathname.split("/").pop();
const editorHost = document.getElementById("source");
const titleInput = document.getElementById("title");
const statusDot = document.getElementById("status");
const preview = document.getElementById("preview");
const sidebar = document.getElementById("sidebar");
const threadsBox = document.getElementById("threads");
const shareButton = document.getElementById("share-button");
const shareMenu = document.getElementById("share-menu");
const copyLink = document.getElementById("copy-link");

let shareId = "";
let shareAccess = "none";
let threads = [];

const roster = makeRoster(document.getElementById("roster"));

const refreshPreview = debounce(async () => {
  if (preview.classList.contains("hidden")) return;
  const result = await api(`/api/docs/${docId}/rendered`);
  if (result.ok) {
    preview.innerHTML = result.html;
    renderMermaidIn(preview);
  }
}, 400);

// Re-render on theme switch so mermaid diagrams pick up the matching theme.
window.addEventListener("mw-theme", () => refreshPreview());

const handle = bindEditor(
  editorHost,
  wsUrl({ docId }),
  {
    onText: () => refreshPreview(),
    onTitle: (title) => {
      if (document.activeElement !== titleInput) titleInput.value = title;
      document.title = `${title} — MeetingWords`;
    },
    onStatus: (status) => {
      statusDot.className = `status-dot ${status}`;
    },
    onRoster: (participants) => roster.setRoster(participants),
    onPresence: (p) => roster.presence(p, lineOfIndex(handle.session.text, p.index)),
    onPresenceLeave: (clientId) => roster.leave(clientId),
    onThreadsUpdated: () => loadThreads(),
  },
  { placeholder: t("editor.writeMarkdown"), lineNumbers: linenosOn },
);

// Console/debug affordance (agents driving a browser use it too).
window.mf = { handle };

initScrollSync(handle.view, preview);
preview.classList.toggle("show-linenos", linenosOn);

// --- doc meta ---------------------------------------------------------------

async function loadState() {
  const result = await api(`/api/docs/${docId}`);
  if (result.status === 401) {
    location.href = "/login";
    return;
  }
  if (!result.ok) {
    alert(result.error || t("editor.docNotFound"));
    location.href = "/";
    return;
  }
  shareId = result.doc.shareId;
  shareAccess = result.doc.shareAccess;
  updateShareUi();
  threads = result.threads || [];
  drawThreads();
}

async function loadThreads() {
  const result = await api(`/api/docs/${docId}`);
  if (result.ok) {
    threads = result.threads || [];
    drawThreads();
  }
}

titleInput.addEventListener(
  "input",
  debounce(async () => {
    await api(`/api/docs/${docId}`, { method: "PUT", body: { title: titleInput.value } });
  }, 500),
);

// --- share menu ---------------------------------------------------------------

function updateShareUi() {
  for (const option of shareMenu.querySelectorAll("[data-access]")) {
    option.setAttribute("aria-checked", String(option.dataset.access === shareAccess));
  }
  const isPrivate = shareAccess === "none";
  document.getElementById("share-dot").classList.toggle("hidden", isPrivate);
  document.getElementById("copy-sep").classList.toggle("hidden", isPrivate);
  copyLink.classList.toggle("hidden", isPrivate);
}

shareButton.addEventListener("click", (event) => {
  event.stopPropagation();
  shareMenu.classList.toggle("hidden");
});
document.addEventListener("click", (event) => {
  if (!shareMenu.contains(event.target)) shareMenu.classList.add("hidden");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") shareMenu.classList.add("hidden");
});

for (const option of shareMenu.querySelectorAll("[data-access]")) {
  option.addEventListener("click", async () => {
    const result = await api(`/api/docs/${docId}`, {
      method: "PUT",
      body: { shareAccess: option.dataset.access },
    });
    if (result.ok) {
      shareAccess = result.shareAccess;
      updateShareUi(); // menu stays open so Copy link is right there
    }
  });
}

copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(`${location.origin}/s/${shareId}`);
  const label = copyLink.querySelector("span");
  label.textContent = t("editor.copied");
  setTimeout(() => (label.textContent = t("editor.copyLink")), 1200);
});

document.getElementById("download-md").addEventListener("click", () => {
  downloadFile(markdownFilename(titleInput.value), handle.session.text);
  shareMenu.classList.add("hidden");
});

// --- panels -------------------------------------------------------------------

initViewMode({
  main: document.querySelector(".editor-main"),
  editorHost,
  preview,
  divider: document.getElementById("pane-divider"),
  onModeChange: (mode) => {
    if (mode !== "edit") refreshPreview();
  },
});

setPressed("toggle-linenos", linenosOn);
document.getElementById("toggle-linenos").addEventListener("click", () => {
  const on = localStorage.getItem(LINENOS_KEY) !== "1";
  localStorage.setItem(LINENOS_KEY, on ? "1" : "0");
  handle.setLineNumbers(on);
  preview.classList.toggle("show-linenos", on);
  setPressed("toggle-linenos", on);
});

document.getElementById("toggle-comments").addEventListener("click", () => {
  sidebar.classList.toggle("hidden");
  setPressed("toggle-comments", !sidebar.classList.contains("hidden"));
});

// --- comments -------------------------------------------------------------------

function drawThreads() {
  renderThreads(threadsBox, threads, {
    onJump: (thread) => {
      const at = handle.session.text.indexOf(thread.anchor.quote);
      if (at !== -1) handle.select(at, at + thread.anchor.quote.length);
    },
    onReply: async (thread) => {
      const body = prompt(t("editor.replyPrompt"));
      if (!body) return;
      await api(`/api/docs/${docId}/threads/${thread.id}/replies`, { method: "POST", body: { body } });
    },
    onResolve: async (thread) => {
      await api(`/api/docs/${docId}/threads/${thread.id}`, {
        method: "PATCH",
        body: { resolved: !thread.resolved },
      });
    },
    onDelete: async (thread) => {
      if (!confirm(t("editor.deleteThread"))) return;
      await api(`/api/docs/${docId}/threads/${thread.id}`, { method: "DELETE" });
    },
  });
}

document.getElementById("comment-selection").addEventListener("click", async () => {
  const { from: start, to: end } = handle.selection();
  if (start === end) {
    alert(t("editor.selectSomeText"));
    return;
  }
  const text = handle.session.text;
  const quote = text.slice(start, end);
  const body = prompt(t("editor.commentPrompt", { quote: quote.slice(0, 120) }));
  if (!body) return;
  await api(`/api/docs/${docId}/threads`, {
    method: "POST",
    body: {
      anchor: {
        quote,
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

loadState();
