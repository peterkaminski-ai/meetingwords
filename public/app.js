import { initI18n, t } from "/i18n.js";
import { api, applyInstance, debounce, el, initTheme, timeAgo } from "/ui.js";

initI18n();
initTheme();
applyInstance();

const list = document.getElementById("list");
const search = document.getElementById("search");

async function loadDocs() {
  const q = search.value.trim();
  const result = await api(`/api/docs${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  if (result.status === 401) {
    location.href = "/login";
    return;
  }
  list.replaceChildren();
  if (!result.docs?.length) {
    list.append(el("p", { class: "muted" }, q ? t("list.noMatch") : t("list.empty")));
    return;
  }
  for (const doc of result.docs) {
    list.append(
      el(
        "a",
        { class: "doc-card", href: `/d/${doc.id}` },
        el(
          "div",
          { style: "display:flex; align-items:center; gap:8px;" },
          el("h3", { style: "flex:1" }, doc.title),
          doc.share_access !== "none"
            ? el("span", { class: "badge shared" }, t("list.shared", { access: doc.share_access }))
            : null,
          el(
            "button",
            {
              class: "danger",
              onclick: async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!confirm(t("list.deleteConfirm", { title: doc.title }))) return;
                await api(`/api/docs/${doc.id}`, { method: "DELETE" });
                loadDocs();
              },
            },
            t("list.delete"),
          ),
        ),
        el("div", { class: "snippet" }, doc.snippet || "(empty)"),
        el("div", { class: "meta" }, t("list.updated", { ago: timeAgo(doc.updated_at) })),
      ),
    );
  }
}

document.getElementById("new-button").addEventListener("click", async () => {
  const result = await api("/api/docs", { method: "POST", body: {} });
  if (result.ok) location.href = `/d/${result.doc.id}`;
});

search.addEventListener("input", debounce(loadDocs, 250));

document.getElementById("logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  localStorage.removeItem("mw_owner_token");
  location.href = "/login";
});

// --- agent keys -------------------------------------------------------------

const keysDialog = document.getElementById("keys-dialog");
const keysList = document.getElementById("keys-list");
const keyReveal = document.getElementById("key-reveal");

async function loadKeys() {
  const result = await api("/api/keys");
  keysList.replaceChildren();
  for (const key of result.keys || []) {
    keysList.append(
      el(
        "div",
        { class: "keyrow" },
        el("span", { style: "flex:1" }, key.label),
        el("span", { class: "muted small" }, timeAgo(key.created_at)),
        el(
          "button",
          {
            class: "danger",
            onclick: async () => {
              if (!confirm(t("keys.revokeConfirm", { label: key.label }))) return;
              await api(`/api/keys/${key.id}`, { method: "DELETE" });
              loadKeys();
            },
          },
          t("keys.revoke"),
        ),
      ),
    );
  }
  if (!result.keys?.length) {
    keysList.append(el("p", { class: "muted small" }, t("keys.none")));
  }
}

document.getElementById("keys-button").addEventListener("click", () => {
  keyReveal.classList.add("hidden");
  loadKeys();
  keysDialog.showModal();
});

document.getElementById("keys-close").addEventListener("click", () => keysDialog.close());

document.getElementById("key-create").addEventListener("click", async () => {
  const labelInput = document.getElementById("key-label");
  const label = labelInput.value.trim();
  if (!label) return;
  const result = await api("/api/keys", { method: "POST", body: { label } });
  if (result.ok) {
    labelInput.value = "";
    document.getElementById("key-value").textContent = result.key;
    keyReveal.classList.remove("hidden");
    loadKeys();
  }
});

loadDocs();
