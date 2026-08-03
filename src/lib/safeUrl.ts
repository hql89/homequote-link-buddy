/**
 * Guarding links that came from data rather than from us.
 *
 * `businesses.website_url` is rendered directly into an `href` on the public
 * listing page. React escapes text, but it does not stop an href from carrying
 * a `javascript:` or `data:` scheme — those execute on click. The field is
 * currently empty for every listing and is only written by the privileged
 * import path, so this is a guard rather than a live incident; it exists
 * because "no data yet" is not a security property, and the next writer of
 * that column will not necessarily remember.
 */

/** The only schemes safe to put in a link a visitor can click. */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * Returns the URL only if it is a plain web address, otherwise null so the
 * caller can render nothing at all.
 *
 * A bare domain ("example.com") is accepted and normalised to https://, since
 * that is how people actually type a website and rejecting it would silently
 * drop legitimate links.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // Control characters are used to smuggle a scheme past naive checks
  // ("java\tscript:alert(1)"), and are never legitimate in a URL.
  // eslint-disable-next-line no-control-regex -- intentional: this check exists to reject them.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!SAFE_SCHEMES.has(parsed.protocol.toLowerCase())) return null;
  // A scheme with no host ("https:///path") is not a usable destination.
  if (!parsed.hostname) return null;

  return parsed.toString();
}
