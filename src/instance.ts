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

export function instanceInfo(env: Env): InstanceInfo {
  const name = (env.INSTANCE_NAME || "").trim() || SOFTWARE_NAME;
  const frontdesk = (env.FRONTDESK_URL || "").trim();
  return {
    name,
    branded: name !== SOFTWARE_NAME,
    software: { name: SOFTWARE_NAME, version: SOFTWARE_VERSION, url: SOFTWARE_URL },
    bannerHtml: env.INSTANCE_BANNER_MD ? renderMarkdown(env.INSTANCE_BANNER_MD) : null,
    frontdeskUrl: frontdesk ? frontdesk.replace(/\/+$/, "") : null,
  };
}
