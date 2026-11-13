/**
 * Drops every trailing slash from a base URL.
 *
 * <p>`base.replace(/\/+$/, '')` does the same thing, but that pattern is
 * super-linear when the input is a long run of slashes (Sonar `javascript:S5852`):
 * the engine tries every start position inside the run before it can fail the
 * anchor and move on. The base URL comes from a build-time env var, so a bad
 * value would stall the request that uses it. A loop is linear, exact and has
 * no regex to backtrack.
 *
 * <p>Only ASCII slash (0x2F) is a separator in a URL: a backslash is left alone,
 * exactly like the regex did.
 */
export function stripTrailingSlashes(base: string): string {
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 0x2f) {
    end -= 1;
  }
  return base.slice(0, end);
}
