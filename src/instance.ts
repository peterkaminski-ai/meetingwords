import pkg from "../package.json";
import type { Env } from "./env";
import { renderMarkdown } from "./render";

// ---------------------------------------------------------------------------
// Instance identity: what THIS deployment is called vs. what software it runs.
// The textpile pattern (INSTANCE_NAME / SOFTWARE_NAME): instance branding is
// configuration; the software line in the footer is the attribution slot every
// deployment carries. Unconfigured, an instance is simply "MeetingWords".
// ---------------------------------------------------------------------------

export const SOFTWARE_NAME = "MeetingWords";
export const SOFTWARE_VERSION: string = pkg.version;
export const SOFTWARE_URL = "https://meetingwords.com";

export type InstanceInfo = {
  /** Display name of this deployment (INSTANCE_NAME, else the software name). */
  name: string;
  /** True when INSTANCE_NAME sets a name of its own. */
  branded: boolean;
  software: { name: string; version: string; url: string };
  /** Optional operator notice (INSTANCE_BANNER_MD), rendered + sanitized. */
  bannerHtml: string | null;
  /** Front-desk base URL (FRONTDESK_URL): "" = same origin, null = no front desk. */
  frontdeskUrl: string | null;
};

/**
 * INSTANCE_BANNER_MD is either a single markdown string or a JSON object of
 * language-keyed markdown ({"en": "...", "es": "..."}). The core stays
 * mechanism-only: the operator supplies every translation; we just pick one.
 * Resolution: requested language → "en" → the first value provided.
 */
export function bannerMarkdown(raw: string | undefined, lang: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  if (value.startsWith("{")) {
    try {
      const map = JSON.parse(value) as unknown;
      if (map && typeof map === "object" && !Array.isArray(map)) {
        const entries = map as Record<string, unknown>;
        const pick = entries[lang] ?? entries.en ?? Object.values(entries)[0];
        return typeof pick === "string" && pick.trim() ? pick : null;
      }
    } catch {
      // not JSON — a banner that happens to start with "{" is still a banner
    }
  }
  return value;
}

/** "es-MX" → "es"; anything unrecognizable → "en". */
export function normalizeLang(raw: string | undefined): string {
  const base = String(raw || "").toLowerCase().split("-")[0].replace(/[^a-z]/g, "");
  return base || "en";
}

export function instanceInfo(env: Env, lang = "en"): InstanceInfo {
  const name = (env.INSTANCE_NAME || "").trim() || SOFTWARE_NAME;
  const frontdesk = (env.FRONTDESK_URL || "").trim();
  const bannerMd = bannerMarkdown(env.INSTANCE_BANNER_MD, lang);
  return {
    name,
    branded: name !== SOFTWARE_NAME,
    software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION, url: SOFTWARE_URL },
    bannerHtml: bannerMd ? renderMarkdown(bannerMd) : null,
    frontdeskUrl: frontdesk ? frontdesk.replace(/\/+$/, "") : null,
  };
}
