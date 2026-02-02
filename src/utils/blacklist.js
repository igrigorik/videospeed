/**
 * Blacklist checking utility
 * Works in both content script and test contexts
 */

/**
 * Check if URL matches blacklist patterns
 * @param {string} blacklist - Newline separated list of patterns
 * @param {string} href - URL to check
 * @returns {boolean} Whether URL is blacklisted
 */
export function isBlacklisted(blacklist, href) {
  if (!blacklist) return false;

  const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
  const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

  const escapeRegExp = (str) => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

  for (const rawMatch of blacklist.split('\n')) {
    const match = rawMatch.replace(regStrip, '');
    if (match.length === 0) continue;

    let regexp;
    if (match.startsWith('/')) {
      try {
        const parts = match.split('/');
        if (parts.length < 3) continue;

        const hasFlags = regEndsWithFlags.test(match);
        const flags = hasFlags ? parts.pop() : '';
        const regex = parts.slice(1, hasFlags ? undefined : -1).join('/');

        if (!regex) continue;
        regexp = new RegExp(regex, flags);
      } catch (err) {
        continue;
      }
    } else {
      const escapedMatch = escapeRegExp(match);
      const looksLikeDomain = match.includes('.') && !match.includes('/');

      if (looksLikeDomain) {
        regexp = new RegExp(`(^|\\.|//)${escapedMatch}(\\/|:|$)`);
      } else {
        regexp = new RegExp(escapedMatch);
      }
    }

    if (regexp.test(href)) {
      return true;
    }
  }

  return false;
}
