import { describe, expect, it } from "vitest";
import { isSecureConnection } from "./auth-constants";

// The regression guard for the 2FA login failure, and it has to live HERE rather
// than in the E2E suite: Playwright runs `next dev`, i.e. NODE_ENV=development,
// so a bug gated on NODE_ENV === "production" is invisible to every browser test
// there is. That is exactly why the original shipped.

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("isSecureConnection", () => {
  it("does NOT set secure for a plain-HTTP origin", () => {
    // The whole bug. `docker-compose.prod.yml` publishes 3000 directly and the
    // TLS proxy is optional, so this is a supported way to run the app — and a
    // secure cookie here is discarded by the browser without any error, leaving
    // /login/2fa with no user and no explanation.
    expect(isSecureConnection(headers({ origin: "http://192.168.1.50:3000" }), {})).toBe(false);
  });

  it("sets secure for an HTTPS origin", () => {
    expect(isSecureConnection(headers({ origin: "https://zaehlwerk.example.com" }), {})).toBe(true);
  });

  it("follows x-forwarded-proto from a terminating proxy", () => {
    // Caddy/nginx/Cloudflare terminate TLS and forward over http — the browser
    // spoke HTTPS, so the cookie must be secure even though this hop is not.
    expect(
      isSecureConnection(headers({ "x-forwarded-proto": "https", host: "zaehlwerk.example.com" }), {}),
    ).toBe(true);
    expect(isSecureConnection(headers({ "x-forwarded-proto": "http", host: "lxc:3000" }), {})).toBe(
      false,
    );
  });

  it("takes the first hop when several proxies appended their own", () => {
    expect(isSecureConnection(headers({ "x-forwarded-proto": "https, http" }), {})).toBe(true);
    expect(isSecureConnection(headers({ "x-forwarded-proto": "http, https" }), {})).toBe(false);
  });

  it("tolerates a trailing colon and odd casing", () => {
    expect(isSecureConnection(headers({ "x-forwarded-proto": "HTTPS:" }), {})).toBe(true);
  });

  it("prefers x-forwarded-proto over the raw origin", () => {
    // Behind a proxy the origin the browser reports is the public one, but the
    // forwarded header is the explicit statement about the browser's connection.
    expect(
      isSecureConnection(headers({ "x-forwarded-proto": "https", origin: "http://lxc:3000" }), {}),
    ).toBe(true);
  });

  it("lets an explicit AUTH_URL win over the headers", () => {
    expect(
      isSecureConnection(headers({ "x-forwarded-proto": "http" }), {
        AUTH_URL: "https://zaehlwerk.example.com",
      }),
    ).toBe(true);
    expect(
      isSecureConnection(headers({ "x-forwarded-proto": "https" }), {
        AUTH_URL: "http://lxc:3000",
      }),
    ).toBe(false);
  });

  it("accepts NEXTAUTH_URL as the legacy name", () => {
    expect(
      isSecureConnection(headers({}), {
        NEXTAUTH_URL: "https://zaehlwerk.example.com",
      }),
    ).toBe(true);
  });

  it("falls back to the headers when AUTH_URL is malformed", () => {
    // A typo in an env var must not lock everyone out of the second factor.
    expect(
      isSecureConnection(headers({ "x-forwarded-proto": "https" }), {
        AUTH_URL: "not a url",
      }),
    ).toBe(true);
  });

  it("reads the connection, not the deployment mode", () => {
    // The bug in one line. "Production" says nothing about how the browser
    // reached the app, and this signature cannot even see NODE_ENV — same env,
    // opposite answers, decided entirely by the connection.
    expect(isSecureConnection(headers({ origin: "http://lxc:3000" }), {})).toBe(false);
    expect(isSecureConnection(headers({ origin: "https://zaehlwerk.example.com" }), {})).toBe(true);
  });

  it("defaults to not-secure when nothing identifies the connection", () => {
    // Plain HTTP is the only case where `secure` actively breaks the flow, so an
    // unknown connection must fail towards "still works".
    expect(isSecureConnection(headers({}), {})).toBe(false);
  });

  it("falls back to referer when there is no origin", () => {
    expect(isSecureConnection(headers({ referer: "https://zaehlwerk.example.com/login" }), {})).toBe(
      true,
    );
  });
});
