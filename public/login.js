import { initI18n, lang, t } from "/i18n.js";
import { api, applyInstance, initTheme } from "/ui.js";

initI18n();
initTheme();

const TOKEN_KEY = "mw_owner_token";
const form = document.getElementById("form");
const setupTokenInput = document.getElementById("setup-token");
const urlSetupToken = new URLSearchParams(location.search).get("setup") || "";
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirm");
const errorBox = document.getElementById("error");
const submit = document.getElementById("submit");

let mode = "login";

// Which building is this? Two instances look identical without it (the
// production flagship vs. a local dev copy bit us first).
document.getElementById("instance-host").textContent = location.host;

async function boot() {
  // A localStorage token can re-establish the cookie without a password.
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    const result = await api("/api/auth/token", { method: "POST", body: { token: saved } });
    if (result.ok) {
      location.href = "/";
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
  }

  const viewer = await api(`/api/viewer?lang=${encodeURIComponent(lang)}`);
  applyInstance(viewer);
  if (viewer.ownerAuthenticated) {
    location.href = "/";
    return;
  }
  if (!viewer.authConfigured) {
    mode = "setup";
    confirmInput.classList.remove("hidden");
    if (viewer.setupTokenRequired && !urlSetupToken) setupTokenInput.classList.remove("hidden");
    submit.textContent = t("login.setPassphrase");
    document.querySelector(".sub").textContent = t("login.firstVisit");
    return;
  }

  // A locked-out owner needs a direction, not a dead end: front-desk
  // recovery where a front desk exists, honest no-reset guidance where not.
  const lostLine = document.getElementById("lost-line");
  const frontdesk = viewer.instance?.frontdeskUrl;
  if (frontdesk !== null && frontdesk !== undefined) {
    const link = document.createElement("a");
    link.href = `${frontdesk}/help#support`;
    link.textContent = t("login.lostFronted");
    lostLine.replaceChildren(link);
  } else {
    lostLine.textContent = t("login.lostSelf");
  }
  lostLine.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  const body =
    mode === "setup"
      ? {
          password: passwordInput.value,
          confirmPassword: confirmInput.value,
          setupToken: urlSetupToken || setupTokenInput.value.trim() || undefined,
        }
      : { password: passwordInput.value };
  const result = await api(`/api/auth/${mode === "setup" ? "setup" : "login"}`, {
    method: "POST",
    body,
  });
  if (!result.ok) {
    errorBox.textContent = result.error || "Something went wrong.";
    return;
  }
  if (result.token) localStorage.setItem(TOKEN_KEY, result.token);
  location.href = "/";
});

boot();
