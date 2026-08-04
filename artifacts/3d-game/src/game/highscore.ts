const STORAGE_KEY = 'bird-flight-best-score';

/** Highest Ring Challenge score achieved so far, persisted in this browser via localStorage. */
export function getBestScore(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // localStorage can throw in locked-down/private-browsing contexts — fail quietly to 0.
    return 0;
  }
}

/** Persists `score` as the new best if it beats the current best. Returns the resulting best. */
export function saveBestScoreIfHigher(score: number): number {
  const current = getBestScore();
  if (score <= current) return current;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(score));
  } catch {
    // Ignore write failures (e.g. storage disabled) — the in-memory value still updates below.
  }
  return score;
}
