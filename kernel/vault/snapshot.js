const fileSnapshot = (st) => ({
  dev: st.dev,
  ino: st.ino,
  size: st.size,
  mtime: st.mtimeMs,
  ctime: st.ctimeMs
})

const sameSnapshot = (snapshot, st) => !!(
  snapshot && st &&
  snapshot.dev === st.dev &&
  snapshot.ino === st.ino &&
  snapshot.size === st.size &&
  snapshot.mtime === st.mtimeMs &&
  snapshot.ctime === st.ctimeMs
)

// Adding or removing a hardlink legitimately changes ctime without changing
// the file identity or bytes. Use this only across Vault's own link updates;
// hashing and externally visible mutations still require sameSnapshot().
const sameContentState = (snapshot, st) => !!(
  snapshot && st &&
  snapshot.dev === st.dev &&
  snapshot.ino === st.ino &&
  snapshot.size === st.size &&
  snapshot.mtime === st.mtimeMs
)

module.exports = { fileSnapshot, sameSnapshot, sameContentState }
