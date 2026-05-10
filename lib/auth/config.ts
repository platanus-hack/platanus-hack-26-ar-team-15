export const RP_NAME = "Consentinel";

export const RP_ID = process.env.RP_ID || "localhost";

const DEFAULT_ORIGIN =
  process.env.NODE_ENV === "production"
    ? `https://${RP_ID}`
    : "http://localhost:3000";

export const RP_ORIGIN = process.env.RP_ORIGIN || DEFAULT_ORIGIN;

export const SESSION_PASSWORD = readSessionPassword();

function readSessionPassword(): string {
  const configured = process.env.SESSION_PASSWORD;
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_PASSWORD must be configured in production.");
  }

  return "consentinel_dev_session_password_change_me_min_32_chars";
}

export const SESSION_COOKIE = "consentinel_session";

/**
 * Returns the expected origin for WebAuthn verification.
 *
 * In production we always use RP_ORIGIN exactly. In development we accept
 * the request's actual origin when it points at localhost, which lets the
 * dev server work on any port (3000, 3001, etc) without manual env edits.
 */
export function getExpectedOrigin(reqOrigin: string | null | undefined): string {
  if (process.env.NODE_ENV === "production") return RP_ORIGIN;
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  if (reqOrigin && /^https?:\/\/localhost(?::\d+)?$/.test(reqOrigin)) {
    return reqOrigin;
  }
  return RP_ORIGIN;
}
