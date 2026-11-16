/**
 * Site rules: which rules a profile has, and which rule matches a URL.
 *
 * Rules are `{ pattern, enabled, speed }` objects stored under `siteRules`.
 * Profiles saved before site rules existed carry a newline-separated
 * `blacklist` string instead, which reads as a list of disabled rules.
 * Pure ES module — no DOM dependencies.
 */

const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;
const escapeRegExp = (str) => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

/** Sites where VSC stays off until the user says otherwise. */
export const DEFAULT_SITE_RULES = Object.freeze(
  ['imgur.com', 'teams.microsoft.com', 'meet.google.com'].map((pattern) =>
    Object.freeze({ pattern, enabled: false, speed: null })
  )
);

/**
 * Compile a pattern string into a RegExp.
 *
 * Supports three forms:
 *   1. Regex notation:  /pattern/flags
 *   2. Domain literal:  youtube.com  →  /(^|\.|\/\/)youtube\.com(\/|:|$)/
 *   3. Substring:       any other string  →  escaped literal match
 *
 * @param {string} raw - Pattern string (trimmed)
 * @returns {RegExp|null} Compiled regex, or null if invalid
 */
function compilePattern(raw) {
  const pattern = raw.replace(regStrip, '');
  if (pattern.length === 0) {
    return null;
  }

  if (pattern.startsWith('/')) {
    try {
      const parts = pattern.split('/');
      if (parts.length < 3) {
        return null;
      }

      const hasFlags = regEndsWithFlags.test(pattern);
      const flags = hasFlags ? parts.pop() : '';
      const regex = parts.slice(1, hasFlags ? undefined : -1).join('/');

      if (!regex) {
        return null;
      }
      return new RegExp(regex, flags);
    } catch {
      return null;
    }
  }

  const escaped = escapeRegExp(pattern);
  const looksLikeDomain = pattern.includes('.') && !pattern.includes('/');

  if (looksLikeDomain) {
    return new RegExp(`(^|\\.|//)${escaped}(\\/|:|$)`);
  }
  return new RegExp(escaped);
}

/**
 * Match a URL against an array of site rule objects.
 * Returns the first rule whose pattern matches, or null.
 *
 * @param {Array<{pattern: string}>} rules - Rule objects (must have a `pattern` field)
 * @param {string} href - URL to test
 * @returns {Object|null} First matching rule, or null
 */
export function matchSiteRule(rules, href) {
  if (!rules || !rules.length) {
    return null;
  }

  for (const rule of rules) {
    // An entry without a pattern string matches nothing. Stored rules are not
    // validated on import, and one bad entry must not take the rest down.
    const regexp = typeof rule?.pattern === 'string' ? compilePattern(rule.pattern) : null;
    if (regexp && regexp.test(href)) {
      return rule;
    }
  }

  return null;
}

/**
 * Read a legacy blacklist as disabled site rules, one per non-empty line.
 *
 * @param {string} blacklist - Newline-separated pattern string
 * @returns {Array<{pattern: string, enabled: boolean, speed: null}>}
 */
function rulesFromBlacklist(blacklist) {
  return blacklist
    .split('\n')
    .map((line) => line.replace(regStrip, ''))
    .filter(Boolean)
    .map((pattern) => ({ pattern, enabled: false, speed: null }));
}

/**
 * The site rules in force for a stored profile: what the user saved, else the
 * defaults.
 *
 * Rules are saved under two keys, so "saved" means the `siteRules` list, where
 * an empty list is a deliberate "no rules", or else the legacy `blacklist`.
 * The content bridge enforces this list and the options page displays it;
 * both call this function so the two cannot disagree.
 *
 * @param {Object} stored - Settings as stored, without defaults filled in
 * @returns {Array<{pattern: string, enabled: boolean, speed: number|null}>}
 */
export function selectSiteRules(stored) {
  if (Array.isArray(stored.siteRules)) {
    return stored.siteRules;
  }
  if (typeof stored.blacklist === 'string') {
    return rulesFromBlacklist(stored.blacklist);
  }
  return DEFAULT_SITE_RULES;
}
