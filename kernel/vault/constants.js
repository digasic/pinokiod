const CANDIDATE_SIZE_BASE = process.platform === "win32" ? 1024 : 1000
const SIZE_THRESHOLD = 100 * CANDIDATE_SIZE_BASE ** 2
const CANDIDATE_SIZE_OPTIONS = [10, 50, 100, 500]
  .map((value) => value * CANDIDATE_SIZE_BASE ** 2)
  .concat(CANDIDATE_SIZE_BASE ** 3)
const MINIMUM_CANDIDATE_SIZE = CANDIDATE_SIZE_OPTIONS[0]
const isCandidateFileSize = (size, threshold) => size > 0 && size >= threshold

module.exports = {
  MINIMUM_CANDIDATE_SIZE,
  SIZE_THRESHOLD,
  CANDIDATE_SIZE_OPTIONS,
  isCandidateFileSize,
  TMP_SUFFIX: ".pinokio-dedup-tmp",
  SHA256_RE: /^[0-9a-f]{64}$/,
  ENTRY_BATCH_SIZE: 256,
  DIR_CONCURRENCY: 8,
  STAT_CONCURRENCY: 32,
  HASH_INACTIVITY_MS: 120 * 1000
}
