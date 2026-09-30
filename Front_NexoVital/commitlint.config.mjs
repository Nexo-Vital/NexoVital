/**
 * Commit message linting.
 *
 * Extends the conventional-commit ruleset only. Subject language is NOT
 * restricted: the repo commits in Spanish, so only the conventional format
 * (type(scope): subject) matters here.
 */
export default {
  extends: ['@commitlint/config-conventional'],
};
