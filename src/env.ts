export type Env = {
  DOC: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace<import("./registry").Registry>;
  ASSETS: Fetcher;

  // Instance identity (all optional; see src/instance.ts).
  INSTANCE_NAME?: string; // what this deployment is called; default "MeetingWords"
  INSTANCE_BANNER_MD?: string; // optional operator notice, markdown, shown on pages

  // Owner-credential lifecycle (all optional; see DESIGN.md "Auth model").
  SETUP_TOKEN?: string; // when set, /api/auth/setup requires it (provisioning race)
  FLEET_ADMIN_KEY?: string; // when set, enables POST /api/fleet/reset-owner
};

// ---------------------------------------------------------------------------
// Worker -> Doc DO header contract. The Worker authenticates every
// request (owner session/token/API key, or share-link access) and forwards
// the verdict in these headers; the DO trusts them. DO stubs are reachable
// only from the Worker, so this is an internal trust boundary, not an
// external one.
// ---------------------------------------------------------------------------

export const H_ROLE = "x-mw-role"; // "owner" | "guest"
export const H_ACCESS = "x-mw-access"; // effective ShareAccess for guests; "owner" for owner
export const H_AGENT = "x-mw-agent"; // API-key label when the caller is an agent
export const H_GUEST_ID = "x-mw-guest-id"; // stable guest identity (cookie)
export const H_GUEST_NAME = "x-mw-guest-name"; // URI-encoded display name
