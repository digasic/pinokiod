const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const Database = require("better-sqlite3")

const DATABASE_APPLICATION_ID = 0x5641554c
const DATABASE_VERSION = 3

const isMissing = (error) => !!(error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR"))

const unsafePath = (filePath) => {
  const error = new Error(`Storage index path is not safe: ${filePath}`)
  error.code = "EVAULTPATH"
  return error
}

const placeholders = (values) => values.map(() => "?").join(", ")

class RegistryCore {
  constructor(root) {
    this.root = path.resolve(root)
    this.databasePath = path.resolve(this.root, "registry.sqlite3")
    this.database = null
    this.maxEvents = 2000
    this.scanSizes = new Map()
    this.scanInodes = new Map()
    this.scanAnchorInodes = new Set()
    this.scanHashWorkFiles = 0
    this.scanHashWorkBytes = 0
  }

  async load() {
    let rootStat = null
    try {
      rootStat = await fs.promises.lstat(this.root)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
      throw unsafePath(this.root)
    }
    if (!rootStat) await fs.promises.mkdir(this.root, { recursive: false, mode: 0o700 })

    let databaseStat = null
    try {
      databaseStat = await fs.promises.lstat(this.databasePath)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (databaseStat && (!databaseStat.isFile() || databaseStat.isSymbolicLink())) {
      throw unsafePath(this.databasePath)
    }

    this.database = new Database(this.databasePath)
    try {
      this.database.pragma("journal_mode = DELETE")
      this.database.pragma("synchronous = NORMAL")
      this.database.pragma("foreign_keys = ON")
      this.database.pragma("busy_timeout = 5000")
      this.database.pragma("cache_size = -65536")
      this.database.pragma("temp_store = FILE")
      this.checkSchemaIdentity()
      this.createSchema()
      this.dropLegacyScanSchema()
      this.createScanSchema()
      this.createFolderDiscoverySchema()
      this.database.pragma(`application_id = ${DATABASE_APPLICATION_ID}`)
      this.database.pragma(`user_version = ${DATABASE_VERSION}`)
    } catch (error) {
      this.database.close()
      this.database = null
      throw error
    }
    if (!databaseStat) await fs.promises.chmod(this.databasePath, 0o600)
    return { existed: !!databaseStat }
  }

  checkSchemaIdentity() {
    const applicationId = this.database.pragma(
      "application_id", { simple: true })
    const version = this.database.pragma("user_version", { simple: true })
    if (applicationId === DATABASE_APPLICATION_ID &&
        version === DATABASE_VERSION) return

    const tables = this.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all().map((row) => row.name)
    if (!tables.length) return

    const error = new Error(
      "The Save Space database uses an unsupported schema.")
    error.code = "EVAULTSCHEMA"
    throw error
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS content (
        hash TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        verified_at INTEGER,
        anchor_verified_at INTEGER,
        anchor_present INTEGER NOT NULL DEFAULT 0,
        anchor_dev INTEGER,
        anchor_ino INTEGER,
        anchor_size INTEGER,
        anchor_mtime REAL,
        anchor_ctime REAL,
        anchor_nlink INTEGER
      );

      CREATE TABLE IF NOT EXISTS anchors (
        store_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        path TEXT NOT NULL,
        verified_at INTEGER,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        nlink INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        PRIMARY KEY (store_id, hash),
        UNIQUE (path),
        FOREIGN KEY (hash) REFERENCES content(hash) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS anchors_reclaimable_page_idx
        ON anchors(nlink, size DESC, store_id, hash);
      CREATE INDEX IF NOT EXISTS anchors_inode_idx
        ON anchors(dev, ino);

      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        source_id TEXT,
        app TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('reference', 'duplicate', 'linked', 'unavailable')
        ),
        unavailable_reason TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS files_hash_path_idx ON files(hash, path);
      CREATE INDEX IF NOT EXISTS files_inode_path_idx
        ON files(dev, ino, path);
      CREATE INDEX IF NOT EXISTS files_status_path_idx
        ON files(status, path);
      CREATE INDEX IF NOT EXISTS files_status_size_path_idx
        ON files(status, size, path);
      CREATE INDEX IF NOT EXISTS files_source_path_idx
        ON files(source_id, path);
      CREATE INDEX IF NOT EXISTS files_source_size_path_idx
        ON files(source_id, size, path);
      CREATE INDEX IF NOT EXISTS files_source_status_path_idx
        ON files(source_id, status, path);
      CREATE INDEX IF NOT EXISTS files_source_status_size_path_idx
        ON files(source_id, status, size, path);
      CREATE INDEX IF NOT EXISTS files_size_path_idx ON files(size, path);
      CREATE TABLE IF NOT EXISTS file_summaries (
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        PRIMARY KEY (source_id, status)
      );

      CREATE TABLE IF NOT EXISTS inode_savings (
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        bytes REAL NOT NULL,
        PRIMARY KEY (dev, ino, source_id)
      );

      CREATE TABLE IF NOT EXISTS source_savings (
        source_id TEXT PRIMARY KEY,
        bytes REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hash_summaries (
        hash TEXT PRIMARY KEY,
        file_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inode_summaries (
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        file_count INTEGER NOT NULL,
        PRIMARY KEY (dev, ino)
      );

      CREATE TABLE IF NOT EXISTS global_summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        reclaimable_count INTEGER NOT NULL DEFAULT 0,
        reclaimable_bytes INTEGER NOT NULL DEFAULT 0,
        activity_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO global_summary(id) VALUES (1);

      CREATE TABLE IF NOT EXISTS activity_summaries (
        source_id TEXT PRIMARY KEY,
        activity_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scans (
        scope_id TEXT PRIMARY KEY,
        completed_at INTEGER NOT NULL,
        dirs INTEGER NOT NULL,
        files INTEGER NOT NULL,
        bytes_total INTEGER NOT NULL,
        candidates INTEGER NOT NULL,
        hashed INTEGER NOT NULL,
        hash_total INTEGER NOT NULL,
        hash_bytes INTEGER NOT NULL,
        inode_reuses INTEGER NOT NULL,
        unstable_hashes INTEGER NOT NULL,
        hash_failures INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        walk_duration_ms INTEGER NOT NULL,
        hash_wait_duration_ms INTEGER NOT NULL,
        hash_duration_ms INTEGER NOT NULL,
        details TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        hash TEXT,
        path TEXT,
        app TEXT,
        source_id TEXT,
        bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS events_source_idx
        ON events(source_id, id);

    `)
    this.database.exec(`
      DROP TRIGGER IF EXISTS content_summary_insert;
      DROP TRIGGER IF EXISTS content_summary_delete;
      DROP TRIGGER IF EXISTS content_summary_update;

      CREATE TRIGGER IF NOT EXISTS anchors_summary_insert
      AFTER INSERT ON anchors
      WHEN NEW.nlink = 1 BEGIN
        UPDATE global_summary SET
          reclaimable_count = reclaimable_count + 1,
          reclaimable_bytes = reclaimable_bytes + NEW.size
        WHERE id = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS anchors_summary_delete
      AFTER DELETE ON anchors
      WHEN OLD.nlink = 1 BEGIN
        UPDATE global_summary SET
          reclaimable_count = reclaimable_count - 1,
          reclaimable_bytes = reclaimable_bytes - OLD.size
        WHERE id = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS anchors_summary_update
      AFTER UPDATE OF nlink, size ON anchors BEGIN
        UPDATE global_summary SET
          reclaimable_count = reclaimable_count -
            CASE WHEN OLD.nlink = 1 THEN 1 ELSE 0 END +
            CASE WHEN NEW.nlink = 1 THEN 1 ELSE 0 END,
          reclaimable_bytes = reclaimable_bytes -
            CASE WHEN OLD.nlink = 1 THEN OLD.size ELSE 0 END +
            CASE WHEN NEW.nlink = 1 THEN NEW.size ELSE 0 END
        WHERE id = 1;
      END;
    `)
    this.rebuildAnchorSummaries()
    this.recreateFileTriggers()
  }

  rebuildAnchorSummaries() {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
      FROM anchors
      WHERE nlink = 1
    `).get()
    this.database.prepare(`
      UPDATE global_summary SET
        reclaimable_count = ?,
        reclaimable_bytes = ?
      WHERE id = 1
    `).run(Number(row.count) || 0, Number(row.bytes) || 0)
  }

  dropLegacyScanSchema() {
    this.database.pragma("foreign_keys = OFF")
    try {
      this.database.exec(`
        DROP TABLE IF EXISTS main.scan_files;
        DROP TABLE IF EXISTS main.scan_anchors;
        DROP TABLE IF EXISTS main.scan_runs;
      `)
    } finally {
      this.database.pragma("foreign_keys = ON")
    }
  }

  createScanSchema() {
    this.database.exec(`
      CREATE TEMP TABLE scan_runs (
        id TEXT PRIMARY KEY,
        scope_id TEXT,
        started_at INTEGER NOT NULL
      ) WITHOUT ROWID;

      CREATE TEMP TABLE scan_exclusions (
        run_id TEXT NOT NULL,
        path TEXT NOT NULL,
        prefix TEXT NOT NULL,
        source_id TEXT,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, path),
        FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;

      CREATE TEMP TABLE scan_files (
        run_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        nlink INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        source_id TEXT,
        app TEXT,
        hash TEXT,
        hash_attempted INTEGER NOT NULL DEFAULT 0,
        hash_needed INTEGER NOT NULL DEFAULT 0,
        managed INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        unavailable_reason TEXT,
        old_status TEXT,
        PRIMARY KEY (run_id, path),
        FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX temp.scan_files_group_idx
        ON scan_files(run_id, hash, dev, status, path);
      CREATE INDEX temp.scan_files_work_idx
        ON scan_files(run_id, size, dev, ino, path);
      CREATE INDEX temp.scan_files_hash_work_idx
        ON scan_files(run_id, size, dev, ino, path)
        WHERE hash IS NULL AND hash_attempted = 0 AND hash_needed = 1;
      CREATE INDEX temp.scan_files_inode_path_idx
        ON scan_files(run_id, dev, ino, path);

      CREATE TEMP TABLE scan_anchors (
        run_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        hash_name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        nlink INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        verified_hash TEXT,
        verify_attempted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, store_id, hash_name),
        FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX temp.scan_anchors_inode_idx
        ON scan_anchors(run_id, dev, ino);
      CREATE INDEX temp.scan_anchors_size_idx
        ON scan_anchors(run_id, size);

      CREATE TEMP TABLE scan_linked_groups (
        run_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        dev INTEGER NOT NULL,
        mode_bits INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        PRIMARY KEY (run_id, hash, dev, mode_bits, uid, gid),
        FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX temp.scan_linked_groups_hash_idx
        ON scan_linked_groups(run_id, hash, dev);

      CREATE TEMP TABLE scan_stores (
        run_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        dev INTEGER NOT NULL,
        can_link INTEGER NOT NULL,
        root TEXT NOT NULL,
        PRIMARY KEY (run_id, store_id),
        UNIQUE (run_id, dev),
        FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
    `)
  }

  createFolderDiscoverySchema() {
    this.database.exec(`
      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_runs (
        id TEXT PRIMARY KEY,
        threshold INTEGER NOT NULL,
        root TEXT NOT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        eligible_file_count INTEGER NOT NULL DEFAULT 0,
        eligible_bytes INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_devices (
        run_id TEXT NOT NULL,
        dev INTEGER NOT NULL,
        PRIMARY KEY (run_id, dev),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_references (
        run_id TEXT NOT NULL,
        path TEXT NOT NULL,
        hash TEXT,
        hash_attempted INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        PRIMARY KEY (run_id, path),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_reference_match_idx
        ON folder_discovery_references(
          run_id, size, dev, hash_attempted, hash, mode, uid, gid, path
        );

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_anchors (
        run_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        valid INTEGER NOT NULL DEFAULT 0,
        checked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, store_id, hash),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_anchor_match_idx
        ON folder_discovery_anchors(
          run_id, size, dev, hash, mode, uid, gid, checked
        );

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_files (
        run_id TEXT NOT NULL,
        path TEXT NOT NULL,
        parent TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        ctime REAL NOT NULL,
        dev INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        nlink INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        match_candidate INTEGER NOT NULL DEFAULT 0,
        hash TEXT,
        hash_attempted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, path),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_file_work_idx
        ON folder_discovery_files(
          run_id, match_candidate, hash_attempted, size, dev, ino, path
        );
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_file_group_idx
        ON folder_discovery_files(run_id, size, dev, ino, path);
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_file_hash_idx
        ON folder_discovery_files(
          run_id, hash, size, dev, mode, uid, gid, path
        );

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_matches (
        run_id TEXT NOT NULL,
        identity TEXT NOT NULL,
        path TEXT NOT NULL,
        parent TEXT NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        dev INTEGER NOT NULL,
        mode INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        gid INTEGER NOT NULL,
        PRIMARY KEY (run_id, identity),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_nodes (
        run_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        parent TEXT,
        direct_file_count INTEGER NOT NULL DEFAULT 0,
        direct_bytes INTEGER NOT NULL DEFAULT 0,
        scope_file_count INTEGER NOT NULL DEFAULT 0,
        scope_bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        eligible_file_count INTEGER NOT NULL,
        eligible_bytes INTEGER NOT NULL,
        child_count INTEGER NOT NULL DEFAULT 0,
        selected INTEGER NOT NULL DEFAULT 0,
        selected_inside INTEGER NOT NULL DEFAULT 0,
        recommended INTEGER NOT NULL DEFAULT 0,
        broader INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, folder),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_node_parent_idx
        ON folder_discovery_nodes(
          run_id, parent, bytes DESC, file_count DESC, folder
        );

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_recommendations (
        run_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        PRIMARY KEY (run_id, folder),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS temp.folder_discovery_recommendation_page_idx
        ON folder_discovery_recommendations(
          run_id, bytes DESC, file_count DESC, folder
        );

      CREATE TEMP TABLE IF NOT EXISTS folder_discovery_selected_paths (
        run_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        prefix TEXT NOT NULL,
        PRIMARY KEY (run_id, folder),
        FOREIGN KEY (run_id) REFERENCES folder_discovery_runs(id)
          ON DELETE CASCADE
      ) WITHOUT ROWID;
    `)
  }

  resetFolderDiscoverySchema() {
    this.database.exec(`
      DROP TABLE IF EXISTS temp.folder_discovery_selected_paths;
      DROP TABLE IF EXISTS temp.folder_discovery_recommendations;
      DROP TABLE IF EXISTS temp.folder_discovery_nodes;
      DROP TABLE IF EXISTS temp.folder_discovery_matches;
      DROP TABLE IF EXISTS temp.folder_discovery_files;
      DROP TABLE IF EXISTS temp.folder_discovery_anchors;
      DROP TABLE IF EXISTS temp.folder_discovery_references;
      DROP TABLE IF EXISTS temp.folder_discovery_devices;
      DROP TABLE IF EXISTS temp.folder_discovery_runs;
    `)
    this.createFolderDiscoverySchema()
  }

  resetScanSchema() {
    this.database.exec(`
      DROP TABLE IF EXISTS temp.scan_stores;
      DROP TABLE IF EXISTS temp.scan_linked_groups;
      DROP TABLE IF EXISTS temp.scan_anchors;
      DROP TABLE IF EXISTS temp.scan_files;
      DROP TABLE IF EXISTS temp.scan_exclusions;
      DROP TABLE IF EXISTS temp.scan_runs;
    `)
    this.createScanSchema()
  }

  dropFileTriggers() {
    this.database.exec(`
      DROP TRIGGER IF EXISTS files_summary_insert;
      DROP TRIGGER IF EXISTS files_summary_delete;
      DROP TRIGGER IF EXISTS files_summary_update;
      DROP TRIGGER IF EXISTS files_group_insert;
      DROP TRIGGER IF EXISTS files_group_delete;
      DROP TRIGGER IF EXISTS files_group_update;
    `)
  }

  createFileTriggers() {
    this.database.exec(`
      CREATE TRIGGER files_summary_insert
      AFTER INSERT ON files
      WHEN NEW.unavailable_reason IS NOT 'stale' BEGIN
        INSERT INTO file_summaries(source_id, status, file_count, bytes)
        VALUES (COALESCE(NEW.source_id, ''), NEW.status, 1, NEW.size)
        ON CONFLICT(source_id, status) DO UPDATE SET
          file_count = file_count + 1,
          bytes = bytes + NEW.size;
      END;

      CREATE TRIGGER files_summary_delete
      AFTER DELETE ON files
      WHEN OLD.unavailable_reason IS NOT 'stale' BEGIN
        UPDATE file_summaries SET
          file_count = file_count - 1,
          bytes = bytes - OLD.size
        WHERE source_id = COALESCE(OLD.source_id, '')
          AND status = OLD.status;
        DELETE FROM file_summaries
        WHERE source_id = COALESCE(OLD.source_id, '')
          AND status = OLD.status
          AND file_count <= 0;
      END;

      CREATE TRIGGER files_summary_update
      AFTER UPDATE OF source_id, status, size, unavailable_reason ON files BEGIN
        UPDATE file_summaries SET
          file_count = file_count - 1,
          bytes = bytes - OLD.size
        WHERE source_id = COALESCE(OLD.source_id, '')
          AND status = OLD.status
          AND OLD.unavailable_reason IS NOT 'stale';
        DELETE FROM file_summaries
        WHERE source_id = COALESCE(OLD.source_id, '')
          AND status = OLD.status
          AND file_count <= 0;
        INSERT INTO file_summaries(source_id, status, file_count, bytes)
        SELECT COALESCE(NEW.source_id, ''), NEW.status, 1, NEW.size
        WHERE NEW.unavailable_reason IS NOT 'stale'
        ON CONFLICT(source_id, status) DO UPDATE SET
          file_count = file_count + 1,
          bytes = bytes + NEW.size;
      END;

      CREATE TRIGGER files_group_insert
      AFTER INSERT ON files BEGIN
        INSERT INTO inode_summaries(dev, ino, file_count)
        SELECT NEW.dev, NEW.ino, 1
        WHERE NEW.status = 'linked'
          AND NEW.unavailable_reason IS NOT 'stale'
        ON CONFLICT(dev, ino) DO UPDATE SET
          file_count = file_count + 1;
        INSERT INTO hash_summaries(hash, file_count)
        SELECT NEW.hash, 1
        WHERE NEW.hash IS NOT NULL
          AND NEW.unavailable_reason IS NOT 'stale'
        ON CONFLICT(hash) DO UPDATE SET
          file_count = file_count + 1;
      END;

      CREATE TRIGGER files_group_delete
      AFTER DELETE ON files BEGIN
        UPDATE inode_summaries SET file_count = file_count - 1
        WHERE dev = OLD.dev AND ino = OLD.ino
          AND OLD.status = 'linked'
          AND OLD.unavailable_reason IS NOT 'stale';
        DELETE FROM inode_summaries
        WHERE dev = OLD.dev AND ino = OLD.ino AND file_count <= 0;
        UPDATE hash_summaries SET file_count = file_count - 1
        WHERE hash = OLD.hash
          AND OLD.unavailable_reason IS NOT 'stale';
        DELETE FROM hash_summaries
        WHERE hash = OLD.hash AND file_count <= 0;
      END;

      CREATE TRIGGER files_group_update
      AFTER UPDATE OF hash, dev, ino, status, unavailable_reason ON files BEGIN
        UPDATE inode_summaries SET file_count = file_count - 1
        WHERE dev = OLD.dev AND ino = OLD.ino
          AND OLD.status = 'linked'
          AND OLD.unavailable_reason IS NOT 'stale';
        DELETE FROM inode_summaries
        WHERE dev = OLD.dev AND ino = OLD.ino AND file_count <= 0;
        UPDATE hash_summaries SET file_count = file_count - 1
        WHERE hash = OLD.hash
          AND OLD.unavailable_reason IS NOT 'stale';
        DELETE FROM hash_summaries
        WHERE hash = OLD.hash AND file_count <= 0;
        INSERT INTO inode_summaries(dev, ino, file_count)
        SELECT NEW.dev, NEW.ino, 1
        WHERE NEW.status = 'linked'
          AND NEW.unavailable_reason IS NOT 'stale'
        ON CONFLICT(dev, ino) DO UPDATE SET
          file_count = file_count + 1;
        INSERT INTO hash_summaries(hash, file_count)
        SELECT NEW.hash, 1
        WHERE NEW.hash IS NOT NULL
          AND NEW.unavailable_reason IS NOT 'stale'
        ON CONFLICT(hash) DO UPDATE SET
          file_count = file_count + 1;
      END;
    `)
  }

  recreateFileTriggers() {
    this.dropFileTriggers()
    this.createFileTriggers()
  }

  rebuildFileSummaries() {
    this.database.prepare("DELETE FROM file_summaries").run()
    this.database.prepare(`
      INSERT INTO file_summaries(source_id, status, file_count, bytes)
      SELECT
        COALESCE(source_id, ''),
        status,
        COUNT(*),
        COALESCE(SUM(size), 0)
      FROM files
      WHERE unavailable_reason IS NOT 'stale'
      GROUP BY COALESCE(source_id, ''), status
    `).run()
  }

  rebuildGroupSummaries() {
    this.database.prepare("DELETE FROM hash_summaries").run()
    this.database.prepare(`
      INSERT INTO hash_summaries(hash, file_count)
      SELECT hash, COUNT(*)
      FROM files
      WHERE hash IS NOT NULL
        AND unavailable_reason IS NOT 'stale'
      GROUP BY hash
    `).run()
    this.database.prepare("DELETE FROM inode_summaries").run()
    this.database.prepare(`
      INSERT INTO inode_summaries(dev, ino, file_count)
      SELECT dev, ino, COUNT(*)
      FROM files
      WHERE status = 'linked'
        AND unavailable_reason IS NOT 'stale'
      GROUP BY dev, ino
    `).run()
  }

  rebuildSavings() {
    this.database.prepare("DELETE FROM inode_savings").run()
    this.database.prepare(`
      INSERT INTO inode_savings(dev, ino, source_id, bytes)
      WITH linked AS (
        SELECT dev, ino, COUNT(*) AS names
        FROM files
        WHERE status = 'linked'
          AND unavailable_reason IS NOT 'stale'
        GROUP BY dev, ino
      )
      SELECT
        file.dev,
        file.ino,
        COALESCE(file.source_id, ''),
        SUM(file.size - (CAST(file.size AS REAL) / linked.names))
      FROM files file
      JOIN linked USING (dev, ino)
      WHERE file.status = 'linked'
        AND file.unavailable_reason IS NOT 'stale'
      GROUP BY file.dev, file.ino, COALESCE(file.source_id, '')
    `).run()
    this.database.prepare("DELETE FROM source_savings").run()
    this.database.prepare(`
      INSERT INTO source_savings(source_id, bytes)
      SELECT source_id, COALESCE(SUM(bytes), 0)
      FROM inode_savings
      GROUP BY source_id
    `).run()
  }

  rebuildActivitySummaries() {
    this.database.prepare("DELETE FROM activity_summaries").run()
    this.database.prepare(`
      INSERT INTO activity_summaries(source_id, activity_count)
      SELECT COALESCE(source_id, ''), COUNT(*)
      FROM events
      GROUP BY COALESCE(source_id, '')
    `).run()
    const global = this.database.prepare(`
      SELECT COUNT(*) AS count FROM events
    `).get()
    this.database.prepare(`
      UPDATE global_summary SET activity_count = ? WHERE id = 1
    `).run(Number(global.count) || 0)
  }

  refreshInodeSavings(dev, ino) {
    if (!Number.isFinite(dev) || !Number.isFinite(ino)) return
    const previous = this.database.prepare(`
      SELECT source_id, bytes
      FROM inode_savings
      WHERE dev = ? AND ino = ?
    `).all(dev, ino)
    this.database.prepare(
      "DELETE FROM inode_savings WHERE dev = ? AND ino = ?"
    ).run(dev, ino)
    this.database.prepare(`
      INSERT INTO inode_savings(dev, ino, source_id, bytes)
      WITH linked AS (
        SELECT COUNT(*) AS names
        FROM files
        WHERE status = 'linked'
          AND unavailable_reason IS NOT 'stale'
          AND dev = ? AND ino = ?
      )
      SELECT
        file.dev,
        file.ino,
        COALESCE(file.source_id, ''),
        SUM(file.size - (CAST(file.size AS REAL) / linked.names))
      FROM files file, linked
      WHERE file.status = 'linked'
        AND file.unavailable_reason IS NOT 'stale'
        AND file.dev = ?
        AND file.ino = ?
        AND linked.names > 0
      GROUP BY file.dev, file.ino, COALESCE(file.source_id, '')
    `).run(dev, ino, dev, ino)
    const next = this.database.prepare(`
      SELECT source_id, bytes
      FROM inode_savings
      WHERE dev = ? AND ino = ?
    `).all(dev, ino)
    const deltas = new Map()
    for (const row of previous) {
      deltas.set(row.source_id,
        (deltas.get(row.source_id) || 0) - Number(row.bytes))
    }
    for (const row of next) {
      deltas.set(row.source_id,
        (deltas.get(row.source_id) || 0) + Number(row.bytes))
    }
    const updateSourceSavings = this.database.prepare(`
      INSERT INTO source_savings(source_id, bytes)
      VALUES (?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        bytes = MAX(0, source_savings.bytes + ?)
    `)
    for (const [sourceId, delta] of deltas) {
      updateSourceSavings.run(sourceId, Math.max(0, delta), delta)
    }
  }

  close() {
    if (!this.database) return
    this.database.close()
    this.database = null
    this.scanSizes.clear()
    this.scanInodes.clear()
    this.scanAnchorInodes.clear()
    this.scanHashWorkFiles = 0
    this.scanHashWorkBytes = 0
  }

  transaction(callback) {
    return this.database.transaction(callback)()
  }

  getFile(filePath) {
    return this.database.prepare("SELECT * FROM files WHERE path = ?")
      .get(path.resolve(filePath)) || null
  }

  upsertFile(entry) {
    const resolvedPath = path.resolve(entry.path)
    const previous = this.getFile(resolvedPath)
    this.transaction(() => {
      this.database.prepare(`
      INSERT INTO files (
        path, hash, size, mtime, ctime, dev, ino, mode, uid, gid, source_id,
        app, status, unavailable_reason, updated_at
      ) VALUES (
        @path, @hash, @size, @mtime, @ctime, @dev, @ino, @mode, @uid, @gid,
        @source_id, @app, @status, @unavailable_reason, @updated_at
      )
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        size = excluded.size,
        mtime = excluded.mtime,
        ctime = excluded.ctime,
        dev = excluded.dev,
        ino = excluded.ino,
        mode = excluded.mode,
        uid = excluded.uid,
        gid = excluded.gid,
        source_id = excluded.source_id,
        app = excluded.app,
        status = excluded.status,
        unavailable_reason = excluded.unavailable_reason,
        updated_at = excluded.updated_at
      `).run({
      path: resolvedPath,
      hash: entry.hash || null,
      size: Math.max(0, Number(entry.size) || 0),
      mtime: Number(entry.mtime) || 0,
      ctime: Number(entry.ctime) || 0,
      dev: Number(entry.dev) || 0,
      ino: Number(entry.ino) || 0,
      mode: Number(entry.mode) || 0,
      uid: Number(entry.uid) || 0,
      gid: Number(entry.gid) || 0,
      source_id: entry.source_id || null,
      app: entry.app || null,
      status: entry.status,
      unavailable_reason: entry.unavailable_reason || null,
      updated_at: Number(entry.updated_at) || Date.now()
      })
      if (previous && previous.status === "linked") {
        this.refreshInodeSavings(previous.dev, previous.ino)
      }
      if (entry.status === "linked") {
        this.refreshInodeSavings(
          Number(entry.dev) || 0,
          Number(entry.ino) || 0
        )
      }
    })
  }

  removeFile(filePath) {
    const resolvedPath = path.resolve(filePath)
    const previous = this.getFile(resolvedPath)
    let removed = false
    this.transaction(() => {
      removed = this.database.prepare("DELETE FROM files WHERE path = ?")
        .run(resolvedPath).changes > 0
      if (previous && previous.status === "linked") {
        this.refreshInodeSavings(previous.dev, previous.ino)
      }
    })
    return removed
  }

  getContent(hash) {
    return this.database.prepare("SELECT * FROM content WHERE hash = ?")
      .get(hash) || null
  }

  upsertContent(entry) {
    this.database.prepare(`
      INSERT INTO content (
        hash, size, first_seen, verified_at, anchor_verified_at,
        anchor_present, anchor_dev, anchor_ino, anchor_size, anchor_mtime,
        anchor_ctime, anchor_nlink
      ) VALUES (
        @hash, @size, @first_seen, @verified_at, @anchor_verified_at,
        @anchor_present, @anchor_dev, @anchor_ino, @anchor_size,
        @anchor_mtime, @anchor_ctime, @anchor_nlink
      )
      ON CONFLICT(hash) DO UPDATE SET
        size = excluded.size,
        verified_at = COALESCE(excluded.verified_at, content.verified_at),
        anchor_verified_at = excluded.anchor_verified_at,
        anchor_present = excluded.anchor_present,
        anchor_dev = excluded.anchor_dev,
        anchor_ino = excluded.anchor_ino,
        anchor_size = excluded.anchor_size,
        anchor_mtime = excluded.anchor_mtime,
        anchor_ctime = excluded.anchor_ctime,
        anchor_nlink = excluded.anchor_nlink
    `).run({
      hash: entry.hash,
      size: Math.max(0, Number(entry.size) || 0),
      first_seen: Number(entry.first_seen) || Date.now(),
      verified_at: entry.verified_at || null,
      anchor_verified_at: entry.anchor_verified_at || null,
      anchor_present: entry.anchor_present ? 1 : 0,
      anchor_dev: Number.isFinite(entry.anchor_dev) ? entry.anchor_dev : null,
      anchor_ino: Number.isFinite(entry.anchor_ino) ? entry.anchor_ino : null,
      anchor_size: Number.isFinite(entry.anchor_size) ? entry.anchor_size : null,
      anchor_mtime: Number.isFinite(entry.anchor_mtime) ? entry.anchor_mtime : null,
      anchor_ctime: Number.isFinite(entry.anchor_ctime) ? entry.anchor_ctime : null,
      anchor_nlink: Number.isFinite(entry.anchor_nlink) ? entry.anchor_nlink : null
    })
  }

  removeContent(hash) {
    return this.database.prepare("DELETE FROM content WHERE hash = ?")
      .run(hash).changes > 0
  }

  getAnchor(storeId, hash) {
    return this.database.prepare(`
      SELECT * FROM anchors WHERE store_id = ? AND hash = ?
    `).get(storeId, hash) || null
  }

  anchorsForHash(hash) {
    return this.database.prepare(`
      SELECT * FROM anchors WHERE hash = ? ORDER BY store_id
    `).all(hash)
  }

  upsertAnchor(entry) {
    this.database.prepare(`
      INSERT INTO anchors (
        store_id, hash, path, verified_at, dev, ino, size, mtime, ctime,
        nlink, mode, uid, gid
      ) VALUES (
        @store_id, @hash, @path, @verified_at, @dev, @ino, @size, @mtime,
        @ctime, @nlink, @mode, @uid, @gid
      )
      ON CONFLICT(store_id, hash) DO UPDATE SET
        path = excluded.path,
        verified_at = excluded.verified_at,
        dev = excluded.dev,
        ino = excluded.ino,
        size = excluded.size,
        mtime = excluded.mtime,
        ctime = excluded.ctime,
        nlink = excluded.nlink,
        mode = excluded.mode,
        uid = excluded.uid,
        gid = excluded.gid
    `).run({
      store_id: entry.store_id,
      hash: entry.hash,
      path: path.resolve(entry.path),
      verified_at: entry.verified_at || null,
      dev: Number(entry.dev) || 0,
      ino: Number(entry.ino) || 0,
      size: Math.max(0, Number(entry.size) || 0),
      mtime: Number(entry.mtime) || 0,
      ctime: Number(entry.ctime) || 0,
      nlink: Math.max(0, Number(entry.nlink) || 0),
      mode: Number(entry.mode) || 0,
      uid: Number(entry.uid) || 0,
      gid: Number(entry.gid) || 0
    })
  }

  removeAnchor(storeId, hash) {
    return this.database.prepare(`
      DELETE FROM anchors WHERE store_id = ? AND hash = ?
    `).run(storeId, hash).changes > 0
  }

  files(options = {}) {
    const where = []
    const values = []
    if (options.hash) {
      where.push("hash = ?")
      values.push(options.hash)
    }
    if (options.dev !== undefined && options.ino !== undefined) {
      where.push("dev = ? AND ino = ?")
      values.push(options.dev, options.ino)
    }
    if (options.statuses && options.statuses.length) {
      where.push(`status IN (${placeholders(options.statuses)})`)
      values.push(...options.statuses)
    }
    if (options.sourceIds && options.sourceIds.length) {
      where.push(`source_id IN (${placeholders(options.sourceIds)})`)
      values.push(...options.sourceIds)
    }
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 1000))
    const sql = `SELECT * FROM files${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
      ORDER BY path LIMIT ?`
    return this.database.prepare(sql).all(...values, limit)
  }

  updateInodeSnapshots(dev, ino, snapshot) {
    this.transaction(() => {
      this.database.prepare(`
        UPDATE files SET
          size = ?, mtime = ?, ctime = ?, dev = ?, ino = ?,
          mode = ?, uid = ?, gid = ?, updated_at = ?
        WHERE dev = ? AND ino = ?
      `).run(
        snapshot.size, snapshot.mtime, snapshot.ctime,
        snapshot.dev, snapshot.ino,
        snapshot.mode, snapshot.uid, snapshot.gid, Date.now(), dev, ino
      )
      this.refreshInodeSavings(dev, ino)
      if (snapshot.dev !== dev || snapshot.ino !== ino) {
        this.refreshInodeSavings(snapshot.dev, snapshot.ino)
      }
    })
  }

  reclassifyHash(hash, stores = [], anchorSnapshots = []) {
    const rows = this.database.prepare(`
      SELECT * FROM files
      WHERE hash = ?
        AND unavailable_reason IS NOT 'stale'
      ORDER BY path
    `).all(hash)
    if (!rows.length) return { files: 0 }

    const inodeCounts = new Map()
    for (const row of rows) {
      const key = `${row.dev}:${row.ino}`
      inodeCounts.set(key, (inodeCounts.get(key) || 0) + 1)
    }
    const anchors = (anchorSnapshots || []).filter((anchor) =>
      anchor &&
      Number.isFinite(anchor.dev) &&
      Number.isFinite(anchor.ino))
    const storesByDevice = new Map((stores || [])
      .filter((store) => store && Number.isFinite(store.dev))
      .map((store) => [store.dev, store]))
    const metadataKey = (row) =>
      `${Number(row.mode) & 0o7777}:${Number(row.uid)}:${Number(row.gid)}`
    const pathOrder = (left, right) => Buffer.compare(
      Buffer.from(left.path),
      Buffer.from(right.path)
    )
    const states = new Map()

    for (const row of rows) {
      const inodeKey = `${row.dev}:${row.ino}`
      if ((inodeCounts.get(inodeKey) || 0) > 1 ||
          anchors.some((anchor) =>
            row.dev === anchor.dev && row.ino === anchor.ino)) {
        states.set(row.path, {
          status: "linked",
          unavailable_reason: null
        })
      }
    }

    const rowsByDevice = new Map()
    for (const row of rows) {
      if (!rowsByDevice.has(row.dev)) rowsByDevice.set(row.dev, [])
      rowsByDevice.get(row.dev).push(row)
    }
    for (const [dev, deviceRows] of rowsByDevice) {
      const unlinked = deviceRows.filter((row) => !states.has(row.path))
      if (!unlinked.length) continue
      const deviceAnchors = anchors.filter((anchor) => anchor.dev === dev)
      const hasOtherContent = deviceRows.length > 1 ||
        deviceAnchors.length > 0
      if (!hasOtherContent) {
        states.set(unlinked[0].path, {
          status: "reference",
          unavailable_reason: null
        })
        continue
      }
      const store = storesByDevice.get(dev)
      if (!store || store.can_link === false) {
        for (const row of unlinked) {
          states.set(row.path, {
            status: "unavailable",
            unavailable_reason: store ? "hardlinks" : "different_disk"
          })
        }
        continue
      }
      const eligible = []
      for (const row of unlinked) {
        eligible.push(row)
      }

      const linkedMetadata = deviceRows
        .filter((row) =>
          states.get(row.path) &&
          states.get(row.path).status === "linked")
        .map(metadataKey)
      linkedMetadata.push(...deviceAnchors.map(metadataKey))

      if (linkedMetadata.length) {
        const compatible = new Set(linkedMetadata)
        for (const row of eligible) {
          states.set(row.path, compatible.has(metadataKey(row))
            ? { status: "duplicate", unavailable_reason: null }
            : { status: "unavailable", unavailable_reason: "metadata" })
        }
      } else {
        const groups = new Map()
        for (const row of eligible) {
          const key = metadataKey(row)
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(row)
        }
        const chosen = [...groups.values()]
          .map((group) => group.sort(pathOrder))
          .sort((left, right) =>
            right.length - left.length || pathOrder(left[0], right[0]))[0]
        const chosenPaths = new Set(chosen.map((row) => row.path))
        for (const row of eligible) {
          states.set(row.path, chosenPaths.has(row.path)
            ? {
                status: row.path === chosen[0].path
                  ? "reference"
                  : "duplicate",
                unavailable_reason: null
              }
            : { status: "unavailable", unavailable_reason: "metadata" })
        }
      }
    }

    const update = this.database.prepare(`
      UPDATE files SET
        status = ?, unavailable_reason = ?, updated_at = ?
      WHERE path = ?
    `)
    const inodeKeys = new Map(rows.map((row) => [
      `${row.dev}:${row.ino}`,
      { dev: row.dev, ino: row.ino }
    ]))
    this.transaction(() => {
      const now = Date.now()
      for (const row of rows) {
        const state = states.get(row.path)
        update.run(
          state.status,
          state.unavailable_reason,
          now,
          row.path
        )
      }
      for (const inode of inodeKeys.values()) {
        this.refreshInodeSavings(inode.dev, inode.ino)
      }
    })
    return { files: rows.length }
  }

  removeExternalSourceState(sourceId) {
    this.transaction(() => {
      this.database.prepare("DELETE FROM files WHERE source_id = ?")
        .run(sourceId)
      this.removeScan(sourceId)
      this.database.prepare(`
        DELETE FROM content
        WHERE NOT EXISTS (
            SELECT 1 FROM files WHERE files.hash = content.hash
          )
          AND NOT EXISTS (
            SELECT 1 FROM anchors WHERE anchors.hash = content.hash
          )
      `).run()
      this.rebuildSavings()
    })
  }

  beginFolderDiscovery(root, threshold, sourceIds = [], devices = []) {
    const id = crypto.randomUUID()
    const sources = [...new Set(sourceIds.filter((value) =>
      typeof value === "string" && value))]
    const allowedDevices = [...new Set(devices.filter(Number.isFinite))]
    this.transaction(() => {
      this.resetFolderDiscoverySchema()
      this.database.prepare(`
        INSERT INTO folder_discovery_runs(id, threshold, root)
        VALUES (?, ?, ?)
      `).run(
        id,
        Math.max(0, Number(threshold) || 0),
        path.resolve(root)
      )
      const insertDevice = this.database.prepare(`
        INSERT INTO folder_discovery_devices(run_id, dev) VALUES (?, ?)
      `)
      for (const dev of allowedDevices) insertDevice.run(id, dev)
      if (!allowedDevices.length) return
      if (sources.length) {
        this.database.prepare(`
          INSERT INTO folder_discovery_references (
            run_id, path, hash, hash_attempted, size, mtime, ctime, dev, ino,
            mode, uid, gid
          )
          SELECT ?, path, hash, CASE WHEN hash IS NULL THEN 0 ELSE 1 END,
            size, mtime, ctime, dev, ino,
            mode, uid, gid
          FROM files
          WHERE source_id IN (${placeholders(sources)})
            AND dev IN (${placeholders(allowedDevices)})
            AND unavailable_reason IS NOT 'stale'
            AND size > 0
            AND size >= ?
        `).run(
          id,
          ...sources,
          ...allowedDevices,
          Math.max(0, Number(threshold) || 0)
        )
      }
      this.database.prepare(`
        INSERT INTO folder_discovery_anchors (
          run_id, store_id, hash, path, size, mtime, ctime, dev, ino,
          mode, uid, gid
        )
        SELECT ?, store_id, hash, path, size, mtime, ctime, dev, ino,
          mode, uid, gid
        FROM anchors
        WHERE dev IN (${placeholders(allowedDevices)})
          AND size > 0
          AND size >= ?
      `).run(
        id,
        ...allowedDevices,
        Math.max(0, Number(threshold) || 0)
      )
    })
    return { id }
  }

  abortFolderDiscovery(runId = null) {
    const exists = runId
      ? this.database.prepare(
        "SELECT 1 FROM folder_discovery_runs WHERE id = ?").get(runId)
      : this.database.prepare(
        "SELECT 1 FROM folder_discovery_runs LIMIT 1").get()
    if (exists) this.resetFolderDiscoverySchema()
    return { changes: exists ? 1 : 0 }
  }

  folderDiscoveryWorkSummary(runId) {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS files
      FROM (
        SELECT 1
        FROM folder_discovery_files
        WHERE run_id = ?
          AND match_candidate = 1
        GROUP BY CASE
          WHEN ino = 0 THEN 'path:' || path
          ELSE 'inode:' || dev || ':' || ino
        END
      )
    `).get(runId)
    return { files: Number(row.files) || 0 }
  }

  stageFolderDiscoveryFiles(runId, entries = []) {
    if (!Array.isArray(entries) || !entries.length) {
      return { changes: 0 }
    }
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO folder_discovery_files (
        run_id, path, parent, size, mtime, ctime, dev, ino, nlink, mode, uid,
        gid, match_candidate
      )
      SELECT
        @run_id, @path, @parent, @size, @mtime, @ctime, @dev, @ino,
        @nlink, @mode, @uid, @gid, 0
      WHERE @size > 0
        AND @size >= (
          SELECT threshold FROM folder_discovery_runs WHERE id = @run_id
        )
        AND EXISTS (
          SELECT 1 FROM folder_discovery_devices device
          WHERE device.run_id = @run_id AND device.dev = @dev
        )
    `)
    const promoteCandidates = this.database.prepare(`
      UPDATE folder_discovery_files AS candidate
      SET match_candidate = 1
      WHERE candidate.run_id = @run_id
        AND candidate.size = @size
        AND candidate.dev = @dev
        AND candidate.match_candidate = 0
        AND (
          EXISTS (
            SELECT 1 FROM folder_discovery_references reference
            WHERE reference.run_id = candidate.run_id
              AND reference.size = candidate.size
              AND reference.dev = candidate.dev
              AND (
                candidate.ino = 0 OR reference.ino = 0 OR
                reference.ino != candidate.ino
              )
          )
          OR EXISTS (
            SELECT 1 FROM folder_discovery_anchors anchor
            WHERE anchor.run_id = candidate.run_id
              AND anchor.size = candidate.size
              AND anchor.dev = candidate.dev
              AND (
                candidate.ino = 0 OR anchor.ino = 0 OR
                anchor.ino != candidate.ino
              )
          )
          OR EXISTS (
            SELECT 1 FROM folder_discovery_files peer
            WHERE peer.run_id = candidate.run_id
              AND peer.size = candidate.size
              AND peer.dev = candidate.dev
              AND peer.path != candidate.path
              AND (
                candidate.ino = 0 OR peer.ino = 0 OR
                peer.ino != candidate.ino
              )
          )
        )
    `)
    let changes = 0
    const touchedGroups = new Map()
    this.transaction(() => {
      for (const entry of entries) {
        if (!entry || typeof entry.path !== "string" ||
            !Number.isFinite(entry.size) || entry.size <= 0 ||
            !Number.isFinite(entry.dev) ||
            !Number.isFinite(entry.ino)) continue
        const resolvedPath = path.resolve(entry.path)
        const result = insert.run({
          run_id: runId,
          path: resolvedPath,
          parent: path.dirname(resolvedPath),
          size: entry.size,
          mtime: entry.mtime,
          ctime: entry.ctime,
          dev: entry.dev,
          ino: entry.ino,
          nlink: Math.max(1, Number(entry.nlink) || 1),
          mode: Number(entry.mode) || 0,
          uid: Number(entry.uid) || 0,
          gid: Number(entry.gid) || 0
        })
        changes += result.changes
        if (result.changes) {
          touchedGroups.set(`${entry.size}:${entry.dev}`, {
            run_id: runId,
            size: entry.size,
            dev: entry.dev
          })
        }
      }
      for (const group of touchedGroups.values()) {
        promoteCandidates.run(group)
      }
    })
    return { changes }
  }

  folderDiscoveryHashBatch(runId, limit = 128) {
    return this.database.prepare(`
      SELECT candidate.*
      FROM folder_discovery_files candidate
      WHERE candidate.run_id = ?
        AND candidate.match_candidate = 1
        AND candidate.hash_attempted = 0
        AND (
          candidate.ino = 0 OR
          NOT EXISTS (
            SELECT 1 FROM folder_discovery_files peer
            WHERE peer.run_id = candidate.run_id
              AND peer.dev = candidate.dev
              AND peer.ino = candidate.ino
              AND peer.hash_attempted = 0
              AND peer.path < candidate.path
          )
        )
      ORDER BY candidate.size, candidate.dev, candidate.ino, candidate.path
      LIMIT ?
    `).all(runId, Math.max(1, Math.min(1024, Number(limit) || 128)))
  }

  setFolderDiscoveryHash(runId, candidate, hash) {
    if (candidate.ino !== 0) {
      return this.database.prepare(`
        UPDATE folder_discovery_files
        SET hash = ?, hash_attempted = 1
        WHERE run_id = ? AND dev = ? AND ino = ?
      `).run(hash, runId, candidate.dev, candidate.ino).changes
    }
    return this.database.prepare(`
      UPDATE folder_discovery_files
      SET hash = ?, hash_attempted = 1
      WHERE run_id = ? AND path = ?
    `).run(hash, runId, path.resolve(candidate.path)).changes
  }

  markFolderDiscoveryHashFailed(runId, candidate) {
    if (candidate.ino !== 0) {
      return this.database.prepare(`
        UPDATE folder_discovery_files
        SET hash_attempted = 1
        WHERE run_id = ? AND dev = ? AND ino = ?
      `).run(runId, candidate.dev, candidate.ino).changes
    }
    return this.database.prepare(`
      UPDATE folder_discovery_files
      SET hash_attempted = 1
      WHERE run_id = ? AND path = ?
    `).run(runId, path.resolve(candidate.path)).changes
  }

  folderDiscoveryReferences(runId, candidate, hash, limit = 32) {
    return this.database.prepare(`
      SELECT * FROM folder_discovery_references
      WHERE run_id = ?
        AND hash = ?
        AND size = ?
        AND dev = ?
        AND ino != ?
        AND (mode & 4095) = (? & 4095)
        AND uid = ?
        AND gid = ?
      ORDER BY path
      LIMIT ?
    `).all(
      runId,
      hash,
      candidate.size,
      candidate.dev,
      candidate.ino,
      candidate.mode,
      candidate.uid,
      candidate.gid,
      Math.max(1, Math.min(256, Number(limit) || 32))
    )
  }

  folderDiscoveryReferenceHashBatch(runId, candidate, limit = 32) {
    return this.database.prepare(`
      SELECT * FROM folder_discovery_references
      WHERE run_id = ?
        AND size = ?
        AND dev = ?
        AND ino != ?
        AND (mode & 4095) = (? & 4095)
        AND uid = ?
        AND gid = ?
        AND hash IS NULL
        AND hash_attempted = 0
      ORDER BY path
      LIMIT ?
    `).all(
      runId,
      candidate.size,
      candidate.dev,
      candidate.ino,
      candidate.mode,
      candidate.uid,
      candidate.gid,
      Math.max(1, Math.min(256, Number(limit) || 32))
    )
  }

  setFolderDiscoveryReferenceHash(runId, filePath, hash) {
    return this.database.prepare(`
      UPDATE folder_discovery_references
      SET hash = ?, hash_attempted = 1
      WHERE run_id = ? AND path = ?
    `).run(hash, runId, path.resolve(filePath)).changes
  }

  markFolderDiscoveryReferenceHashFailed(runId, filePath) {
    return this.database.prepare(`
      UPDATE folder_discovery_references
      SET hash = NULL, hash_attempted = 1
      WHERE run_id = ? AND path = ?
    `).run(runId, path.resolve(filePath)).changes
  }

  folderDiscoveryAnchors(runId, candidate, hash, limit = 32) {
    return this.database.prepare(`
      SELECT * FROM folder_discovery_anchors
      WHERE run_id = ?
        AND hash = ?
        AND size = ?
        AND dev = ?
        AND (? = 0 OR ino = 0 OR ino != ?)
        AND (mode & 4095) = (? & 4095)
        AND uid = ?
        AND gid = ?
        AND checked = 0
      ORDER BY store_id, path
      LIMIT ?
    `).all(
      runId,
      hash,
      candidate.size,
      candidate.dev,
      Number(candidate.ino) || 0,
      Number(candidate.ino) || 0,
      candidate.mode,
      candidate.uid,
      candidate.gid,
      Math.max(1, Math.min(256, Number(limit) || 32))
    )
  }

  markFolderDiscoveryAnchorChecked(
    runId,
    storeId,
    hash,
    valid
  ) {
    return this.database.prepare(`
      UPDATE folder_discovery_anchors
      SET checked = 1, valid = ?
      WHERE run_id = ? AND store_id = ? AND hash = ?
    `).run(valid ? 1 : 0, runId, storeId, hash).changes
  }

  folderDiscoveryParticipantsCte() {
    return `
      WITH participants AS (
        SELECT
          candidate.*,
          CASE
            WHEN candidate.ino = 0 THEN 'path:' || candidate.path
            ELSE 'inode:' || candidate.dev || ':' || candidate.ino
          END AS identity
        FROM folder_discovery_files candidate
        WHERE candidate.run_id = ?
          AND candidate.hash IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM folder_discovery_references reference
              WHERE reference.run_id = candidate.run_id
                AND reference.hash = candidate.hash
                AND reference.size = candidate.size
                AND reference.dev = candidate.dev
                AND (reference.mode & 4095) = (candidate.mode & 4095)
                AND reference.uid = candidate.uid
                AND reference.gid = candidate.gid
                AND (
                  candidate.ino = 0 OR reference.ino = 0 OR
                  reference.ino != candidate.ino
                )
            )
            OR EXISTS (
              SELECT 1 FROM folder_discovery_anchors anchor
              WHERE anchor.run_id = candidate.run_id
                AND anchor.valid = 1
                AND anchor.hash = candidate.hash
                AND anchor.size = candidate.size
                AND anchor.dev = candidate.dev
                AND (anchor.mode & 4095) = (candidate.mode & 4095)
                AND anchor.uid = candidate.uid
                AND anchor.gid = candidate.gid
                AND (
                  candidate.ino = 0 OR anchor.ino = 0 OR
                  anchor.ino != candidate.ino
                )
            )
            OR EXISTS (
              SELECT 1 FROM folder_discovery_files peer
              WHERE peer.run_id = candidate.run_id
                AND peer.hash = candidate.hash
                AND peer.size = candidate.size
                AND peer.dev = candidate.dev
                AND (peer.mode & 4095) = (candidate.mode & 4095)
                AND peer.uid = candidate.uid
                AND peer.gid = candidate.gid
                AND peer.path != candidate.path
                AND (
                  candidate.ino = 0 OR peer.ino = 0 OR
                  peer.ino != candidate.ino
                )
            )
          )
      )
    `
  }

  folderDiscoveryVerifiedSummary(runId) {
    const row = this.database.prepare(`
      ${this.folderDiscoveryParticipantsCte()}
      SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
      FROM (
        SELECT size,
          ROW_NUMBER() OVER (PARTITION BY identity ORDER BY path) AS rank
        FROM participants
      )
      WHERE rank = 1
    `).get(runId)
    return {
      files: Number(row.files) || 0,
      bytes: Number(row.bytes) || 0
    }
  }

  finalizeFolderDiscoveryMatches(runId) {
    this.transaction(() => {
      this.database.prepare(
        "DELETE FROM folder_discovery_matches WHERE run_id = ?"
      ).run(runId)
      this.database.prepare(`
        ${this.folderDiscoveryParticipantsCte()}, ranked AS (
          SELECT participants.*,
            ROW_NUMBER() OVER (PARTITION BY identity ORDER BY path) AS rank
          FROM participants
        )
        INSERT INTO folder_discovery_matches (
          run_id, identity, path, parent, size, hash, dev, mode, uid, gid
        )
        SELECT
          run_id, identity, path, parent, size, hash, dev, mode, uid, gid
        FROM ranked
        WHERE rank = 1
      `).run(runId)
    })
    const row = this.database.prepare(`
      SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
      FROM folder_discovery_matches WHERE run_id = ?
    `).get(runId)
    return {
      files: Number(row.files) || 0,
      bytes: Number(row.bytes) || 0
    }
  }

  rebuildFolderDiscoverySelectionState(runId) {
    this.database.prepare(`
      UPDATE folder_discovery_nodes AS node
      SET selected = CASE WHEN EXISTS (
        SELECT 1 FROM folder_discovery_selected_paths selection
        WHERE selection.run_id = node.run_id
          AND selection.folder = node.folder
      ) THEN 1 ELSE 0 END,
      selected_inside = 0
      WHERE node.run_id = ?
    `).run(runId)
    this.database.prepare(`
      WITH RECURSIVE ancestors(folder) AS (
        SELECT node.parent
        FROM folder_discovery_selected_paths selection
        JOIN folder_discovery_nodes node
          ON node.run_id = selection.run_id
          AND node.folder = selection.folder
        WHERE selection.run_id = ? AND node.parent IS NOT NULL
        UNION ALL
        SELECT node.parent
        FROM ancestors
        JOIN folder_discovery_nodes node
          ON node.run_id = ? AND node.folder = ancestors.folder
        WHERE node.parent IS NOT NULL
      ), counts AS (
        SELECT folder, COUNT(*) AS count
        FROM ancestors
        GROUP BY folder
      )
      UPDATE folder_discovery_nodes AS node
      SET selected_inside = COALESCE((
        SELECT counts.count FROM counts WHERE counts.folder = node.folder
      ), 0)
      WHERE node.run_id = ?
    `).run(runId, runId, runId)
  }

  finalizeFolderDiscoveryRecommendationState(runId) {
    this.database.prepare(`
      UPDATE folder_discovery_nodes AS node
      SET recommended = CASE WHEN EXISTS (
        SELECT 1 FROM folder_discovery_recommendations recommendation
        WHERE recommendation.run_id = node.run_id
          AND recommendation.folder = node.folder
      ) THEN 1 ELSE 0 END,
      broader = 0
      WHERE node.run_id = ?
    `).run(runId)
    this.database.prepare(`
      WITH RECURSIVE ancestors(folder) AS (
        SELECT node.parent
        FROM folder_discovery_recommendations recommendation
        JOIN folder_discovery_nodes node
          ON node.run_id = recommendation.run_id
          AND node.folder = recommendation.folder
        WHERE recommendation.run_id = ? AND node.parent IS NOT NULL
        UNION
        SELECT node.parent
        FROM ancestors
        JOIN folder_discovery_nodes node
          ON node.run_id = ? AND node.folder = ancestors.folder
        WHERE node.parent IS NOT NULL
      )
      UPDATE folder_discovery_nodes
      SET broader = 1
      WHERE run_id = ?
        AND recommended = 0
        AND folder IN (SELECT folder FROM ancestors)
    `).run(runId, runId, runId)
  }

  prepareFolderDiscoveryResults(runId, selectedRoot) {
    const root = path.resolve(selectedRoot)
    const comparable = (value) => process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value)
    const contains = (ancestor, candidate) => {
      const relative = path.relative(comparable(ancestor), comparable(candidate))
      return relative === "" || (
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      )
    }
    const insertNode = this.database.prepare(`
      INSERT OR IGNORE INTO folder_discovery_nodes (
        run_id, folder, parent, file_count, bytes,
        eligible_file_count, eligible_bytes
      ) VALUES (?, ?, ?, 0, 0, 0, 0)
    `)
    const nodeExists = this.database.prepare(`
      SELECT 1 FROM folder_discovery_nodes
      WHERE run_id = ? AND folder = ?
    `)
    const addDirect = this.database.prepare(`
      UPDATE folder_discovery_nodes
      SET direct_file_count = direct_file_count + ?,
        direct_bytes = direct_bytes + ?
      WHERE run_id = ? AND folder = ?
    `)
    const addScope = this.database.prepare(`
      UPDATE folder_discovery_nodes
      SET scope_file_count = scope_file_count + ?,
        scope_bytes = scope_bytes + ?
      WHERE run_id = ? AND folder = ?
    `)
    const insertRecommendation = this.database.prepare(`
      INSERT INTO folder_discovery_recommendations (
        run_id, folder, file_count, bytes
      ) VALUES (?, ?, ?, ?)
    `)
    let recommendationCount = 0
    this.transaction(() => {
      this.database.prepare(
        "DELETE FROM folder_discovery_nodes WHERE run_id = ?"
      ).run(runId)
      this.database.prepare(
        "DELETE FROM folder_discovery_recommendations WHERE run_id = ?"
      ).run(runId)
      this.database.prepare(
        "DELETE FROM folder_discovery_selected_paths WHERE run_id = ?"
      ).run(runId)
      insertNode.run(runId, root, null)

      const ensureAncestors = (folder) => {
        let current = path.resolve(folder)
        if (!contains(root, current)) return false
        while (true) {
          const parent = comparable(current) === comparable(root)
            ? null
            : path.dirname(current)
          insertNode.run(runId, current, parent)
          if (!parent) break
          current = parent
        }
        return true
      }

      for (const row of this.database.prepare(`
        SELECT parent AS folder, COUNT(*) AS file_count,
          COALESCE(SUM(size), 0) AS bytes
        FROM folder_discovery_matches
        WHERE run_id = ?
        GROUP BY parent
        ORDER BY parent
      `).all(runId)) {
        if (!ensureAncestors(row.folder)) continue
        addDirect.run(
          Math.max(0, Number(row.file_count) || 0),
          Math.max(0, Number(row.bytes) || 0),
          runId,
          path.resolve(row.folder)
        )
      }

      for (const row of this.database.prepare(`
        SELECT parent AS folder, COUNT(*) AS file_count,
          COALESCE(SUM(size), 0) AS bytes
        FROM folder_discovery_files
        WHERE run_id = ?
        GROUP BY parent
        ORDER BY parent
      `).all(runId)) {
        let folder = path.resolve(row.folder)
        if (!contains(root, folder)) continue
        while (!nodeExists.get(runId, folder) &&
            comparable(folder) !== comparable(root)) {
          const parent = path.dirname(folder)
          if (comparable(parent) === comparable(folder)) break
          folder = parent
        }
        if (!nodeExists.get(runId, folder)) continue
        addScope.run(
          Math.max(0, Number(row.file_count) || 0),
          Math.max(0, Number(row.bytes) || 0),
          runId,
          folder
        )
      }

      this.database.prepare(`
        WITH RECURSIVE contributions AS (
          SELECT run_id, folder AS ancestor,
            direct_file_count AS file_count,
            direct_bytes AS bytes,
            scope_file_count AS eligible_file_count,
            scope_bytes AS eligible_bytes
          FROM folder_discovery_nodes
          WHERE run_id = ?
          UNION ALL
          SELECT contribution.run_id, node.parent,
            contribution.file_count, contribution.bytes,
            contribution.eligible_file_count, contribution.eligible_bytes
          FROM contributions contribution
          JOIN folder_discovery_nodes node
            ON node.run_id = contribution.run_id
            AND node.folder = contribution.ancestor
          WHERE node.parent IS NOT NULL
        ), totals AS (
          SELECT run_id, ancestor AS folder,
            SUM(file_count) AS file_count,
            SUM(bytes) AS bytes,
            SUM(eligible_file_count) AS eligible_file_count,
            SUM(eligible_bytes) AS eligible_bytes
          FROM contributions
          GROUP BY run_id, ancestor
        )
        UPDATE folder_discovery_nodes AS node
        SET file_count = totals.file_count,
          bytes = totals.bytes,
          eligible_file_count = totals.eligible_file_count,
          eligible_bytes = totals.eligible_bytes
        FROM totals
        WHERE node.run_id = totals.run_id
          AND node.folder = totals.folder
      `).run(runId)
      this.database.prepare(`
        UPDATE folder_discovery_nodes AS node
        SET child_count = (
          SELECT COUNT(*) FROM folder_discovery_nodes child
          WHERE child.run_id = node.run_id
            AND child.parent = node.folder
            AND child.file_count > 0
        )
        WHERE node.run_id = ?
      `).run(runId)

      const nodeFor = this.database.prepare(`
        SELECT * FROM folder_discovery_nodes
        WHERE run_id = ? AND folder = ?
      `)
      const childrenFor = this.database.prepare(`
        SELECT * FROM folder_discovery_nodes
        WHERE run_id = ? AND parent = ? AND file_count > 0
        ORDER BY bytes DESC, file_count DESC, folder
      `)
      const pending = [root]
      while (pending.length) {
        const folder = pending.pop()
        const node = nodeFor.get(runId, folder)
        if (!node || !(Number(node.file_count) > 0)) continue
        const children = childrenFor.all(runId, folder)
        let recommend = Number(node.direct_file_count) > 0 ||
          !children.length
        if (!recommend && children.length > 1) {
          const unrelatedBytes = Math.max(
            0, Number(node.eligible_bytes) - Number(node.bytes))
          const unrelatedFiles = Math.max(
            0, Number(node.eligible_file_count) - Number(node.file_count))
          recommend = unrelatedBytes <= Number(node.bytes) &&
            unrelatedFiles <= Number(node.file_count)
        }
        if (recommend) {
          insertRecommendation.run(
            runId, node.folder, node.file_count, node.bytes)
          recommendationCount += 1
          continue
        }
        for (let index = children.length - 1; index >= 0; index--) {
          pending.push(children[index].folder)
        }
      }

      this.rebuildFolderDiscoverySelectionState(runId)
      this.finalizeFolderDiscoveryRecommendationState(runId)

      const rootNode = nodeFor.get(runId, root)
      this.database.prepare(`
        UPDATE folder_discovery_runs
        SET root = ?, file_count = ?, bytes = ?,
          eligible_file_count = ?, eligible_bytes = ?
        WHERE id = ?
      `).run(
        root,
        Number(rootNode && rootNode.file_count) || 0,
        Number(rootNode && rootNode.bytes) || 0,
        Number(rootNode && rootNode.eligible_file_count) || 0,
        Number(rootNode && rootNode.eligible_bytes) || 0,
        runId
      )
    })
    return { recommendations: recommendationCount }
  }

  folderDiscoveryResults(
    runId,
    page = 0,
    limit = 500
  ) {
    const pageSize = Math.max(1, Math.min(500, Number(limit) || 500))
    const pageNumber = Math.max(0, Math.floor(Number(page) || 0))
    const rootRow = this.database.prepare(`
      SELECT run.root, run.file_count, run.bytes,
        run.eligible_file_count, run.eligible_bytes,
        node.selected, node.selected_inside, node.recommended, node.broader
      FROM folder_discovery_runs run
      LEFT JOIN folder_discovery_nodes node
        ON node.run_id = run.id AND node.folder = run.root
      WHERE run.id = ?
    `).get(runId)
    const totalRow = this.database.prepare(`
      SELECT COUNT(*) AS count FROM folder_discovery_nodes
      WHERE run_id = ? AND parent = ? AND file_count > 0
    `).get(runId, rootRow ? rootRow.root : "")
    const total = Number(totalRow.count) || 0
    const items = this.database.prepare(`
      SELECT folder, parent, file_count, bytes, eligible_file_count,
        eligible_bytes, child_count, selected, selected_inside,
        recommended, broader
      FROM folder_discovery_nodes
      WHERE run_id = ? AND parent = ? AND file_count > 0
      ORDER BY bytes DESC, file_count DESC, folder
      LIMIT ? OFFSET ?
    `).all(
      runId,
      rootRow ? rootRow.root : "",
      pageSize,
      pageNumber * pageSize
    ).map((row) => ({
      folder: row.folder,
      parent: row.parent,
      name: path.basename(row.folder) || row.folder,
      file_count: Number(row.file_count) || 0,
      bytes: Number(row.bytes) || 0,
      eligible_file_count: Number(row.eligible_file_count) || 0,
      eligible_bytes: Number(row.eligible_bytes) || 0,
      child_count: Number(row.child_count) || 0,
      selected: !!row.selected,
      selected_inside: Number(row.selected_inside) || 0,
      recommended: !!row.recommended,
      broader: !!row.broader
    }))
    return {
      root: rootRow
        ? {
            folder: rootRow.root,
            name: path.basename(rootRow.root) || rootRow.root,
            file_count: Number(rootRow.file_count) || 0,
            bytes: Number(rootRow.bytes) || 0,
            eligible_file_count:
              Number(rootRow.eligible_file_count) || 0,
            eligible_bytes: Number(rootRow.eligible_bytes) || 0,
            child_count: total,
            selected: !!rootRow.selected,
            selected_inside: Number(rootRow.selected_inside) || 0,
            recommended: !!rootRow.recommended,
            broader: !!rootRow.broader
          }
        : null,
      items,
      total,
      page: pageNumber,
      page_size: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      selection: this.folderDiscoverySelectionSummary(runId)
    }
  }

  folderDiscoveryChildren(runId, folder, page = 0, limit = 500) {
    const pageSize = Math.max(1, Math.min(500, Number(limit) || 500))
    const pageNumber = Math.max(0, Math.floor(Number(page) || 0))
    const run = this.database.prepare(
      "SELECT root FROM folder_discovery_runs WHERE id = ?"
    ).get(runId)
    if (!run || typeof folder !== "string" || !path.isAbsolute(folder)) {
      throw new Error("These folder suggestions are no longer current.")
    }
    const parent = path.resolve(folder)
    const known = this.database.prepare(`
      SELECT 1 FROM folder_discovery_nodes
      WHERE run_id = ? AND folder = ?
    `).get(runId, parent)
    if (!known) throw new Error("That suggested folder is no longer current.")
    const total = Number(this.database.prepare(`
      SELECT COUNT(*) AS count FROM folder_discovery_nodes
      WHERE run_id = ? AND parent = ? AND file_count > 0
    `).get(runId, parent).count) || 0
    const items = this.database.prepare(`
      SELECT folder, parent, file_count, bytes, eligible_file_count,
        eligible_bytes, child_count, selected, selected_inside,
        recommended, broader
      FROM folder_discovery_nodes
      WHERE run_id = ? AND parent = ? AND file_count > 0
      ORDER BY bytes DESC, file_count DESC, folder
      LIMIT ? OFFSET ?
    `).all(runId, parent, pageSize, pageNumber * pageSize).map((row) => ({
      folder: row.folder,
      parent: row.parent,
      name: path.basename(row.folder) || row.folder,
      file_count: Number(row.file_count) || 0,
      bytes: Number(row.bytes) || 0,
      eligible_file_count: Number(row.eligible_file_count) || 0,
      eligible_bytes: Number(row.eligible_bytes) || 0,
      child_count: Number(row.child_count) || 0,
      selected: !!row.selected,
      selected_inside: Number(row.selected_inside) || 0,
      recommended: !!row.recommended,
      broader: !!row.broader
    }))
    return {
      folder: parent,
      items,
      total,
      page: pageNumber,
      page_size: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize))
    }
  }

  folderDiscoveryRecommendations(runId, page = 0, limit = 500) {
    const pageSize = Math.max(1, Math.min(500, Number(limit) || 500))
    const pageNumber = Math.max(0, Math.floor(Number(page) || 0))
    const totalRow = this.database.prepare(`
      SELECT COUNT(*) AS count FROM folder_discovery_recommendations
      WHERE run_id = ?
    `).get(runId)
    const total = Number(totalRow.count) || 0
    const items = this.database.prepare(`
      SELECT folder, file_count, bytes
      FROM folder_discovery_recommendations
      WHERE run_id = ?
      ORDER BY bytes DESC, file_count DESC, folder
      LIMIT ? OFFSET ?
    `).all(runId, pageSize, pageNumber * pageSize).map((row) => ({
      folder: row.folder,
      name: path.basename(row.folder) || row.folder,
      file_count: Number(row.file_count) || 0,
      bytes: Number(row.bytes) || 0
    }))
    return {
      items,
      total,
      page: pageNumber,
      page_size: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize))
    }
  }

  updateFolderDiscoverySelection(runId, folder, selected) {
    if (typeof folder !== "string" || !path.isAbsolute(folder.trim())) {
      throw new Error("Choose a valid suggested location.")
    }
    const target = path.resolve(folder.trim())
    const node = this.database.prepare(`
      SELECT folder FROM folder_discovery_nodes
      WHERE run_id = ? AND folder = ? AND file_count > 0
    `).get(runId, target)
    if (!node) throw new Error("That suggested folder is no longer current.")
    const prefix = target.endsWith(path.sep)
      ? target
      : `${target}${path.sep}`
    this.transaction(() => {
      if (selected) {
        this.database.prepare(`
          DELETE FROM folder_discovery_selected_paths
          WHERE run_id = ? AND (
            folder = ? OR
            substr(folder, 1, length(?)) = ? OR
            substr(?, 1, length(prefix)) = prefix
          )
        `).run(runId, target, prefix, prefix, target)
        this.database.prepare(`
          INSERT INTO folder_discovery_selected_paths(run_id, folder, prefix)
          VALUES (?, ?, ?)
        `).run(runId, target, prefix)
      } else {
        this.database.prepare(`
          DELETE FROM folder_discovery_selected_paths
          WHERE run_id = ? AND folder = ?
        `).run(runId, target)
      }
      this.rebuildFolderDiscoverySelectionState(runId)
    })
    const nodes = this.database.prepare(`
      WITH RECURSIVE lineage AS (
        SELECT folder, parent, selected, selected_inside
        FROM folder_discovery_nodes
        WHERE run_id = ? AND folder = ?
        UNION ALL
        SELECT parent.folder, parent.parent,
          parent.selected, parent.selected_inside
        FROM lineage child
        JOIN folder_discovery_nodes parent
          ON parent.run_id = ? AND parent.folder = child.parent
      )
      SELECT folder, selected, selected_inside FROM lineage
    `).all(runId, target, runId).map((row) => ({
      folder: row.folder,
      selected: !!row.selected,
      selected_inside: Number(row.selected_inside) || 0
    }))
    return Object.assign(
      { nodes },
      this.folderDiscoverySelectionSummary(runId)
    )
  }

  folderDiscoverySelectionSummary(runId) {
    const row = this.database.prepare(`
      WITH selected AS (
        SELECT match.*
        FROM folder_discovery_matches match
        WHERE match.run_id = ?
          AND EXISTS (
            SELECT 1 FROM folder_discovery_selected_paths selection
            WHERE selection.run_id = match.run_id
              AND (
                match.path = selection.folder OR
                substr(match.path, 1, length(selection.prefix)) =
                  selection.prefix
              )
          )
      ), selected_groups AS (
        SELECT hash, dev, (mode & 4095) AS mode_bits, uid, gid,
          MAX(size) AS size, COUNT(*) AS inode_count
        FROM selected
        GROUP BY hash, dev, (mode & 4095), uid, gid
      ), contexts AS (
        SELECT hash, dev, (mode & 4095) AS mode_bits, uid, gid,
          CASE
            WHEN ino = 0 THEN 'path:' || path
            ELSE 'inode:' || dev || ':' || ino
          END AS identity
        FROM folder_discovery_references
        WHERE run_id = ? AND hash IS NOT NULL
        UNION
        SELECT hash, dev, (mode & 4095) AS mode_bits, uid, gid,
          CASE
            WHEN ino = 0 THEN 'path:' || path
            ELSE 'inode:' || dev || ':' || ino
          END AS identity
        FROM folder_discovery_anchors
        WHERE run_id = ? AND valid = 1
      ), external_context_groups AS (
        SELECT DISTINCT context.hash, context.dev, context.mode_bits,
          context.uid, context.gid
        FROM contexts context
        WHERE NOT EXISTS (
          SELECT 1 FROM selected
          WHERE selected.hash = context.hash
            AND selected.dev = context.dev
            AND (selected.mode & 4095) = context.mode_bits
            AND selected.uid = context.uid
            AND selected.gid = context.gid
            AND selected.identity = context.identity
        )
      )
      SELECT
        (SELECT COUNT(*) FROM folder_discovery_selected_paths
          WHERE run_id = ?) AS location_count,
        COALESCE(SUM(selected_groups.inode_count), 0) AS file_count,
        COALESCE(SUM(
          CASE
            WHEN external_context_groups.hash IS NOT NULL
            THEN selected_groups.inode_count
            ELSE MAX(0, selected_groups.inode_count - 1)
          END * selected_groups.size
        ), 0) AS bytes
      FROM selected_groups
      LEFT JOIN external_context_groups
        USING (hash, dev, mode_bits, uid, gid)
    `).get(runId, runId, runId, runId)
    return {
      selected_count: Number(row.location_count) || 0,
      selected_files: Number(row.file_count) || 0,
      potential_savings: Number(row.bytes) || 0
    }
  }

  folderDiscoverySelectedHashes(runId) {
    return this.database.prepare(`
      SELECT DISTINCT candidate.hash
      FROM folder_discovery_files candidate
      WHERE candidate.run_id = ?
        AND candidate.hash IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM folder_discovery_selected_paths selection
          WHERE selection.run_id = candidate.run_id
            AND (
              candidate.path = selection.folder OR
              substr(candidate.path, 1, length(selection.prefix)) =
                selection.prefix
            )
        )
      ORDER BY candidate.hash
    `).all(runId).map((row) => row.hash)
  }

  publishFolderDiscoverySelection(
    runId,
    sources = [],
    stores = [],
    classifications = []
  ) {
    const selectedSources = (Array.isArray(sources) ? sources : [])
      .filter((source) => source && typeof source.id === "string" &&
        typeof source.root === "string")
      .map((source) => ({
        id: source.id,
        root: path.resolve(source.root),
        prefix: path.resolve(source.root).endsWith(path.sep)
          ? path.resolve(source.root)
          : `${path.resolve(source.root)}${path.sep}`,
        app: typeof source.app === "string" ? source.app : null
      }))
    if (!selectedSources.length) {
      throw new Error("Choose at least one location to add.")
    }
    const classificationByHash = new Map(
      (Array.isArray(classifications) ? classifications : [])
        .filter((item) => item && typeof item.hash === "string")
        .map((item) => [item.hash,
          Array.isArray(item.anchors) ? item.anchors : []])
    )
    let hashes = []
    let files = 0
    this.transaction(() => {
      const selected = this.folderDiscoverySelectionPaths(runId)
      const selectedKeys = new Set(selected.map((folder) => path.resolve(folder)))
      if (selectedSources.some((source) => !selectedKeys.has(source.root))) {
        throw new Error("The selected locations changed before they were added.")
      }
      this.dropFileTriggers()
      try {
        const now = Date.now()
        this.database.prepare(`
          INSERT INTO content(hash, size, first_seen, verified_at)
          SELECT hash, MAX(size), ?, ?
          FROM folder_discovery_references
          WHERE run_id = ? AND hash IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM folder_discovery_files candidate
              WHERE candidate.run_id = folder_discovery_references.run_id
                AND candidate.hash = folder_discovery_references.hash
                AND EXISTS (
                  SELECT 1 FROM folder_discovery_selected_paths selection
                  WHERE selection.run_id = candidate.run_id
                    AND (
                      candidate.path = selection.folder OR
                      substr(candidate.path, 1, length(selection.prefix)) =
                        selection.prefix
                    )
                )
            )
          GROUP BY hash
          ON CONFLICT(hash) DO UPDATE SET
            size = excluded.size,
            verified_at = excluded.verified_at
        `).run(now, now, runId)
        this.database.prepare(`
          UPDATE files AS published
          SET
            hash = reference.hash,
            updated_at = ?
          FROM folder_discovery_references AS reference
          WHERE reference.run_id = ?
            AND reference.hash IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM folder_discovery_files candidate
              WHERE candidate.run_id = reference.run_id
                AND candidate.hash = reference.hash
                AND EXISTS (
                  SELECT 1 FROM folder_discovery_selected_paths selection
                  WHERE selection.run_id = candidate.run_id
                    AND (
                      candidate.path = selection.folder OR
                      substr(candidate.path, 1, length(selection.prefix)) =
                        selection.prefix
                    )
                )
            )
            AND published.path = reference.path
            AND published.dev = reference.dev
            AND published.ino = reference.ino
            AND published.size = reference.size
            AND published.mtime = reference.mtime
            AND published.ctime = reference.ctime
        `).run(now, runId)
        const upsertContent = this.database.prepare(`
          INSERT INTO content(hash, size, first_seen, verified_at)
          SELECT hash, MAX(size), ?, ?
          FROM folder_discovery_files
          WHERE run_id = ?
            AND hash IS NOT NULL
            AND (
              path = ? OR substr(path, 1, length(?)) = ?
            )
          GROUP BY hash
          ON CONFLICT(hash) DO UPDATE SET
            size = excluded.size,
            verified_at = excluded.verified_at
        `)
        const upsertFiles = this.database.prepare(`
          INSERT INTO files (
            path, hash, size, mtime, ctime, dev, ino, mode, uid, gid,
            source_id, app, status, unavailable_reason, updated_at
          )
          SELECT
            candidate.path,
            candidate.hash,
            candidate.size,
            candidate.mtime,
            candidate.ctime,
            candidate.dev,
            candidate.ino,
            candidate.mode,
            candidate.uid,
            candidate.gid,
            ?, ?,
            CASE WHEN EXISTS (
              SELECT 1 FROM folder_discovery_files peer
              WHERE peer.run_id = candidate.run_id
                AND peer.dev = candidate.dev
                AND peer.ino = candidate.ino
                AND peer.ino != 0
                AND peer.path != candidate.path
                AND (
                  peer.path = ? OR
                  substr(peer.path, 1, length(?)) = ?
                )
            ) THEN 'linked' ELSE 'reference' END,
            NULL, ?
          FROM folder_discovery_files candidate
          WHERE candidate.run_id = ?
            AND (
              candidate.path = ? OR
              substr(candidate.path, 1, length(?)) = ?
            )
          ON CONFLICT(path) DO UPDATE SET
            hash = excluded.hash,
            size = excluded.size,
            mtime = excluded.mtime,
            ctime = excluded.ctime,
            dev = excluded.dev,
            ino = excluded.ino,
            mode = excluded.mode,
            uid = excluded.uid,
            gid = excluded.gid,
            source_id = excluded.source_id,
            app = excluded.app,
            status = excluded.status,
            unavailable_reason = NULL,
            updated_at = excluded.updated_at
        `)
        for (const source of selectedSources) {
          upsertContent.run(
            now, now, runId,
            source.root, source.prefix, source.prefix
          )
          upsertFiles.run(
            source.id, source.app,
            source.root, source.prefix, source.prefix,
            now, runId,
            source.root, source.prefix, source.prefix
          )
        }
        hashes = this.folderDiscoverySelectedHashes(runId)
        for (const hash of hashes) {
          this.reclassifyHash(
            hash,
            stores,
            classificationByHash.get(hash) || []
          )
        }
        this.rebuildFileSummaries()
        this.rebuildGroupSummaries()
        files = Number(this.database.prepare(`
          SELECT COUNT(*) AS count FROM folder_discovery_files candidate
          WHERE candidate.run_id = ?
            AND EXISTS (
              SELECT 1 FROM folder_discovery_selected_paths selection
              WHERE selection.run_id = candidate.run_id
                AND (
                  candidate.path = selection.folder OR
                  substr(candidate.path, 1, length(selection.prefix)) =
                    selection.prefix
                )
            )
        `).get(runId).count) || 0
      } finally {
        this.createFileTriggers()
      }
    })
    return { files, hashes }
  }

  folderDiscoverySelectionPaths(runId) {
    return this.database.prepare(`
      SELECT folder FROM folder_discovery_selected_paths
      WHERE run_id = ?
      ORDER BY folder
    `).all(runId).map((row) => row.folder)
  }

  scanFor(scopeId = null) {
    const row = this.database.prepare("SELECT * FROM scans WHERE scope_id = ?")
      .get(scopeId || "")
    if (!row) return null
    let details = {}
    try {
      details = JSON.parse(row.details)
    } catch (error) {}
    return Object.assign(details, {
      ts: row.completed_at,
      dirs: row.dirs,
      files: row.files,
      bytes_total: row.bytes_total,
      candidates: row.candidates,
      hashed: row.hashed,
      hash_total: row.hash_total,
      hash_bytes: row.hash_bytes,
      inode_reuses: row.inode_reuses,
      unstable_hashes: row.unstable_hashes,
      hash_failures: row.hash_failures,
      duration_ms: row.duration_ms,
      walk_duration_ms: row.walk_duration_ms,
      hash_wait_duration_ms: row.hash_wait_duration_ms,
      hash_duration_ms: row.hash_duration_ms
    })
  }

  removeScan(scopeId) {
    this.database.prepare("DELETE FROM scans WHERE scope_id = ?")
      .run(scopeId || "")
  }

  beginScan(scopeId = null) {
    const id = crypto.randomUUID()
    this.scanSizes.clear()
    this.scanInodes.clear()
    this.scanAnchorInodes.clear()
    this.scanHashWorkFiles = 0
    this.scanHashWorkBytes = 0
    this.transaction(() => {
      this.resetScanSchema()
      this.database.prepare(
        "INSERT INTO scan_runs(id, scope_id, started_at) VALUES (?, ?, ?)"
      ).run(id, scopeId || null, Date.now())
    })
    return id
  }

  abortScan(runId) {
    const exists = this.database.prepare(
      "SELECT 1 FROM scan_runs WHERE id = ?").get(runId)
    if (exists) this.resetScanSchema()
    this.scanSizes.clear()
    this.scanInodes.clear()
    this.scanAnchorInodes.clear()
    this.scanHashWorkFiles = 0
    this.scanHashWorkBytes = 0
    return { changes: exists ? 1 : 0 }
  }

  scanInodeState(entry) {
    if (!(entry.nlink > 1) || entry.ino === 0) return null
    const key = `${entry.dev}:${entry.ino}`
    let state = this.scanInodes.get(key)
    if (!state) {
      state = {
        firstPath: null,
        linked: false,
        knownHash: null,
        workCounted: false
      }
      this.scanInodes.set(key, state)
    }
    return state
  }

  rememberScanHash(entry, hash) {
    if (!hash) return
    const inode = this.scanInodeState(entry)
    if (!inode) return
    inode.knownHash = hash
    if (!inode.workCounted) return
    inode.workCounted = false
    this.scanHashWorkFiles = Math.max(0, this.scanHashWorkFiles - 1)
    this.scanHashWorkBytes = Math.max(
      0, this.scanHashWorkBytes - entry.size)
  }

  addScanHashWork(candidate) {
    if (!candidate || candidate.hash || candidate.workCounted) return
    const { entry } = candidate
    const inode = this.scanInodeState(entry)
    if (inode) {
      if (inode.knownHash || inode.workCounted) return
      inode.workCounted = true
    } else {
      candidate.workCounted = true
    }
    this.scanHashWorkFiles += 1
    this.scanHashWorkBytes += entry.size
  }

  scanHashWork() {
    return {
      hash_work_files: this.scanHashWorkFiles,
      hash_work_bytes: this.scanHashWorkBytes
    }
  }

  checkScanAnchorsForInode(runId, dev, ino, hash) {
    return this.database.prepare(`
      UPDATE scan_anchors SET
        verified_hash = CASE WHEN hash_name = ? THEN ? END,
        verify_attempted = 1
      WHERE run_id = ? AND dev = ? AND ino = ?
    `).run(hash, hash, runId, dev, ino)
  }

  stageExclusions(runId, entries) {
    if (!entries.length) return { changes: 0 }
    const insert = this.database.prepare(`
      INSERT INTO scan_exclusions (
        run_id, path, prefix, source_id, reason, created_at
      ) VALUES (
        @run_id, @path, @prefix, @source_id, @reason, @created_at
      )
      ON CONFLICT(run_id, path) DO UPDATE SET
        source_id = excluded.source_id,
        reason = excluded.reason,
        created_at = excluded.created_at
    `)
    const removeStagedPath = this.database.prepare(`
      DELETE FROM scan_files WHERE run_id = ? AND path = ?
    `)
    let changes = 0
    this.transaction(() => {
      for (const entry of entries) {
        const resolvedPath = path.resolve(entry.path)
        const prefix = resolvedPath.endsWith(path.sep)
          ? resolvedPath
          : `${resolvedPath}${path.sep}`
        changes += insert.run({
          run_id: runId,
          path: resolvedPath,
          prefix,
          source_id: entry.source_id || null,
          reason: entry.reason || "unreadable",
          created_at: Number(entry.created_at) || Date.now()
        }).changes
        removeStagedPath.run(runId, resolvedPath)
      }
    })
    return { changes }
  }

  scanPreviewGroups(runId, hashes) {
    const values = [...new Set(hashes.filter(Boolean))]
    if (!values.length) return new Map()
    return new Map(this.database.prepare(`
      WITH device_groups AS (
        SELECT
          hash,
          dev,
          MAX(size) AS size,
          MIN(path) AS representative_path,
          COUNT(*) AS locations,
          COUNT(DISTINCT CASE
            WHEN ino != 0 THEN printf('%lld:%lld', dev, ino)
            ELSE path
          END) AS inode_count
        FROM scan_files
        WHERE run_id = ?
          AND hash IN (${placeholders(values)})
        GROUP BY hash, dev
      )
      SELECT
        hash,
        MAX(size) AS size,
        MIN(representative_path) AS representative_path,
        SUM(locations) AS locations,
        SUM(MAX(0, inode_count - 1)) AS duplicate_files
      FROM device_groups
      GROUP BY hash
    `).all(runId, ...values).map((row) => {
      const duplicateFiles = Math.max(0, Number(row.duplicate_files) || 0)
      return [row.hash, {
        hash: row.hash,
        size: Number(row.size) || 0,
        representative_path: row.representative_path,
        locations: Number(row.locations) || 0,
        duplicate_files: duplicateFiles,
        bytes: duplicateFiles * (Number(row.size) || 0)
      }]
    }))
  }

  scanPreviewChange(runId, hashes, before) {
    const after = this.scanPreviewGroups(runId, hashes)
    let duplicateFilesDelta = 0
    let bytesDelta = 0
    const groups = []
    for (const hash of new Set([
      ...before.keys(),
      ...after.keys()
    ])) {
      const previous = before.get(hash) || {
        duplicate_files: 0,
        bytes: 0
      }
      const current = after.get(hash) || {
        hash,
        size: previous.size || 0,
        locations: 0,
        duplicate_files: 0,
        bytes: 0
      }
      duplicateFilesDelta +=
        current.duplicate_files - previous.duplicate_files
      bytesDelta += current.bytes - previous.bytes
      if (current.duplicate_files || previous.duplicate_files) {
        groups.push(current)
      }
    }
    return {
      duplicate_files_delta: duplicateFilesDelta,
      bytes_delta: bytesDelta,
      groups
    }
  }

  stageFiles(runId, entries, minimumSize = 0) {
    if (!entries.length) return {
      changes: 0,
      preview: null,
      work: this.scanHashWork()
    }
    const threshold = Math.max(0, Number(minimumSize) || 0)
    const resolvedEntries = entries
      .filter((entry) => entry.nlink > 1 ||
        (entry.size > 0 && entry.size >= threshold))
      .map((entry) => ({
        entry,
        path: path.resolve(entry.path)
      }))
    if (!resolvedEntries.length) return {
      changes: 0,
      preview: null,
      work: this.scanHashWork()
    }
    const previousByPath = new Map(this.database.prepare(`
      SELECT path, hash, size, mtime, ctime, dev, ino, status
      FROM files
      WHERE path IN (${placeholders(resolvedEntries)})
    `).all(...resolvedEntries.map((candidate) => candidate.path))
      .map((row) => [row.path, row]))

    const wantedInodes = new Map()
    for (const candidate of resolvedEntries) {
      const { entry } = candidate
      if (entry.nlink <= 1 || entry.ino === 0) continue
      const key = `${entry.dev}:${entry.ino}`
      if (this.scanAnchorInodes.has(key) || wantedInodes.has(key)) continue
      wantedInodes.set(key, { dev: entry.dev, ino: entry.ino })
    }
    const managedInodes = new Set()
    if (wantedInodes.size) {
      const values = [...wantedInodes.values()]
      const rows = this.database.prepare(`
        WITH wanted(dev, ino) AS (
          VALUES ${values.map(() => "(?, ?)").join(", ")}
        )
        SELECT wanted.dev, wanted.ino
        FROM wanted
        WHERE EXISTS (
          SELECT 1 FROM files INDEXED BY files_inode_path_idx
          WHERE files.dev = wanted.dev
            AND files.ino = wanted.ino
            AND files.status = 'linked'
        )
      `).all(...values.flatMap((value) => [value.dev, value.ino]))
      for (const row of rows) {
        managedInodes.add(`${row.dev}:${row.ino}`)
      }
    }
    const insert = this.database.prepare(`
      INSERT INTO scan_files (
        run_id, path, size, mtime, ctime, dev, ino, nlink, mode, uid, gid,
        source_id, app, hash, hash_needed, managed, status, old_status
      ) VALUES (
        @run_id, @path, @size, @mtime, @ctime, @dev, @ino, @nlink,
        @mode, @uid, @gid, @source_id, @app, @hash, @hash_needed,
        @managed, @status, @old_status
      )
      ON CONFLICT(run_id, path) DO UPDATE SET
        size = excluded.size,
        mtime = excluded.mtime,
        ctime = excluded.ctime,
        dev = excluded.dev,
        ino = excluded.ino,
        nlink = excluded.nlink,
        mode = excluded.mode,
        uid = excluded.uid,
        gid = excluded.gid,
        source_id = excluded.source_id,
        app = excluded.app,
        hash = excluded.hash,
        hash_needed = excluded.hash_needed,
        managed = excluded.managed,
        status = excluded.status
    `)
    const staged = []
    for (const resolved of resolvedEntries) {
      const { entry } = resolved
      const inodeKey = `${entry.dev}:${entry.ino}`
      const anchored = entry.nlink > 1 &&
        this.scanAnchorInodes.has(inodeKey)
      const managed = anchored || (
        entry.nlink > 1 && managedInodes.has(inodeKey)
      )
      if (!managed && (
        entry.size <= 0 ||
        entry.size < threshold
      )) continue
      const previous = previousByPath.get(resolved.path)
      const reusableHash = previous &&
        previous.dev === entry.dev &&
        previous.ino === entry.ino &&
        previous.size === entry.size &&
        previous.mtime === entry.mtime &&
        previous.ctime === entry.ctime
        ? previous.hash
        : null
      staged.push({
        entry,
        path: resolved.path,
        managed,
        hashNeeded: false,
        linked: managed,
        hash: entry.hash || reusableHash || null,
        oldStatus: previous ? previous.status : null
      })
    }
    if (!staged.length) return {
      changes: 0,
      preview: null,
      work: this.scanHashWork()
    }

    const stagedByPath = new Map()
    const promoteHashPaths = new Set()
    const promoteLinkedPaths = new Set()
    for (const candidate of staged) {
      const { entry } = candidate
      const inode = this.scanInodeState(entry)
      if (inode && !candidate.hash && inode.knownHash) {
        candidate.hash = inode.knownHash
      }
      this.rememberScanHash(entry, candidate.hash)
      const sizeState = this.scanSizes.get(entry.size) || {
        files: 0,
        hashNeeded: false,
        firstPath: null,
        firstCandidate: null
      }
      candidate.hashNeeded = sizeState.hashNeeded ||
        candidate.managed ||
        sizeState.files > 0
      if (candidate.hashNeeded &&
          !sizeState.hashNeeded &&
          sizeState.firstPath) {
        const first = stagedByPath.get(sizeState.firstPath)
        const promoted = first || sizeState.firstCandidate
        if (promoted) {
          promoted.hashNeeded = true
          this.addScanHashWork(promoted)
        }
        if (!first) promoteHashPaths.add(sizeState.firstPath)
      }
      if (!sizeState.firstPath) {
        sizeState.firstPath = candidate.path
        sizeState.firstCandidate = candidate
      }
      sizeState.files += 1
      sizeState.hashNeeded = candidate.hashNeeded
      this.scanSizes.set(entry.size, sizeState)
      if (candidate.hashNeeded) this.addScanHashWork(candidate)

      if (entry.nlink > 1 && entry.ino !== 0) {
        if (inode.firstPath && inode.firstPath !== candidate.path) {
          candidate.linked = true
          if (!inode.linked) {
            const first = stagedByPath.get(inode.firstPath)
            if (first) first.linked = true
            else promoteLinkedPaths.add(inode.firstPath)
          }
          inode.linked = true
        } else if (!inode.firstPath) {
          inode.firstPath = candidate.path
          inode.linked = candidate.linked
        }
      }
      stagedByPath.set(candidate.path, candidate)
    }

    const updatePaths = (column, value, paths) => {
      const values = [...paths]
      if (!values.length) return
      this.database.prepare(`
        UPDATE scan_files SET ${column} = ?
        WHERE run_id = ? AND path IN (${placeholders(values)})
      `).run(value, runId, ...values)
    }
    const previewHashes = staged
      .filter((candidate) => candidate.hash)
      .map((candidate) => candidate.hash)
    const knownInodeHashes = new Map(staged
      .filter((candidate) =>
        candidate.hash &&
        candidate.entry.nlink > 1 &&
        candidate.entry.ino !== 0)
      .map((candidate) => [
        `${candidate.entry.dev}:${candidate.entry.ino}`,
        {
          dev: candidate.entry.dev,
          ino: candidate.entry.ino,
          hash: candidate.hash
        }
      ]))
    const previewBefore = this.scanPreviewGroups(runId, previewHashes)
    let changes = 0
    this.transaction(() => {
      updatePaths("hash_needed", 1, promoteHashPaths)
      updatePaths("status", "linked", promoteLinkedPaths)
      for (const candidate of staged) {
        const { entry } = candidate
        changes += insert.run({
          run_id: runId,
          path: candidate.path,
          size: entry.size,
          mtime: entry.mtime,
          ctime: entry.ctime,
          dev: entry.dev,
          ino: entry.ino,
          nlink: entry.nlink,
          mode: entry.mode,
          uid: entry.uid,
          gid: entry.gid,
          source_id: entry.source_id || null,
          app: entry.app || null,
          hash: candidate.hash,
          hash_needed: candidate.hashNeeded ? 1 : 0,
          managed: candidate.managed ? 1 : 0,
          status: candidate.linked ? "linked" : null,
          old_status: candidate.oldStatus
        }).changes
      }
      for (const known of knownInodeHashes.values()) {
        this.checkScanAnchorsForInode(
          runId, known.dev, known.ino, known.hash)
      }
    })
    return {
      changes,
      preview: this.scanPreviewChange(
        runId, previewHashes, previewBefore),
      work: this.scanHashWork()
    }
  }

  stageAnchors(runId, entries) {
    if (!entries.length) return { work: this.scanHashWork() }
    const previousAnchor = this.database.prepare(`
      SELECT * FROM anchors WHERE store_id = ? AND hash = ?
    `)
    const insert = this.database.prepare(`
      INSERT INTO scan_anchors (
        run_id, store_id, hash_name, path, size, mtime, ctime, dev, ino, nlink,
        mode, uid, gid, verified_hash
      ) VALUES (
        @run_id, @store_id, @hash_name, @path, @size, @mtime, @ctime, @dev,
        @ino, @nlink, @mode, @uid, @gid, @verified_hash
      )
      ON CONFLICT(run_id, store_id, hash_name) DO UPDATE SET
        path = excluded.path,
        size = excluded.size,
        mtime = excluded.mtime,
        ctime = excluded.ctime,
        dev = excluded.dev,
        ino = excluded.ino,
        nlink = excluded.nlink,
        mode = excluded.mode,
        uid = excluded.uid,
        gid = excluded.gid,
        verified_hash = excluded.verified_hash
    `)
    this.transaction(() => {
      for (const entry of entries) {
        const previous = previousAnchor.get(
          entry.store_id, entry.hash_name)
        const unchanged = previous && previous.verified_at &&
          previous.dev === entry.dev &&
          previous.ino === entry.ino &&
          previous.size === entry.size &&
          previous.mtime === entry.mtime &&
          previous.ctime === entry.ctime
        insert.run({
          run_id: runId,
          store_id: entry.store_id,
          hash_name: entry.hash_name,
          path: path.resolve(entry.path),
          size: entry.size,
          mtime: entry.mtime,
          ctime: entry.ctime,
          dev: entry.dev,
          ino: entry.ino,
          nlink: entry.nlink,
          mode: entry.mode,
          uid: entry.uid,
          gid: entry.gid,
          verified_hash: unchanged ? entry.hash_name : null
        })
        this.scanAnchorInodes.add(`${entry.dev}:${entry.ino}`)
        if (unchanged) {
          this.rememberScanHash(entry, entry.hash_name)
        } else {
          this.addScanHashWork({
            entry,
            path: path.resolve(entry.path),
            hash: null
          })
        }
        const sizeState = this.scanSizes.get(entry.size) || {
          files: 0,
          hashNeeded: false
        }
        sizeState.hashNeeded = true
        this.scanSizes.set(entry.size, sizeState)
      }
    })
    return { work: this.scanHashWork() }
  }

  markAnchorChecked(runId, anchor, verifiedHash) {
    if (anchor.nlink > 1 && anchor.ino !== 0) {
      this.transaction(() => {
        this.checkScanAnchorsForInode(
          runId, anchor.dev, anchor.ino, verifiedHash)
        this.database.prepare(`
          UPDATE scan_files SET hash = ?, hash_attempted = 1
          WHERE run_id = ? AND dev = ? AND ino = ? AND hash IS NULL
        `).run(verifiedHash, runId, anchor.dev, anchor.ino)
      })
      return
    }
    this.database.prepare(`
      UPDATE scan_anchors SET
        verified_hash = CASE WHEN hash_name = ? THEN ? END,
        verify_attempted = 1
      WHERE run_id = ? AND store_id = ? AND hash_name = ?
    `).run(
      verifiedHash,
      verifiedHash,
      runId,
      anchor.store_id,
      anchor.hash_name
    )
  }

  markAnchorVerificationFailed(runId, anchor) {
    let retryAvailable = false
    this.transaction(() => {
      this.database.prepare(`
        UPDATE scan_anchors SET verify_attempted = 1
        WHERE run_id = ? AND store_id = ? AND hash_name = ?
      `).run(runId, anchor.store_id, anchor.hash_name)
      if (!(anchor.nlink > 1) || anchor.ino === 0) return
      retryAvailable = !!this.database.prepare(`
        SELECT 1
        FROM scan_anchors
        WHERE run_id = ?
          AND dev = ?
          AND ino = ?
          AND verified_hash IS NULL
          AND verify_attempted = 0
        LIMIT 1
      `).get(runId, anchor.dev, anchor.ino)
    })
    return { retry_available: retryAvailable }
  }

  hashWorkBatch(runId, cursor = null, limit = 128) {
    const after = cursor && typeof cursor === "object" ? cursor : null
    const afterCursor = after
      ? `AND
          (candidate.size, candidate.dev, candidate.ino, candidate.path) >
          (@size, @dev, @ino, @path)`
      : ""
    return this.database.prepare(`
      SELECT
        candidate.*,
        CASE WHEN candidate.nlink > 1 AND candidate.ino != 0 THEN (
          SELECT peer.hash
          FROM scan_files peer
          WHERE peer.run_id = candidate.run_id
            AND peer.dev = candidate.dev
            AND peer.ino = candidate.ino
            AND peer.hash IS NOT NULL
          ORDER BY peer.path
          LIMIT 1
        ) END AS reusable_hash
      FROM scan_files candidate
      WHERE candidate.run_id = @run_id
        AND candidate.hash IS NULL
        AND candidate.hash_attempted = 0
        AND candidate.hash_needed = 1
        AND (
          candidate.nlink <= 1 OR
          candidate.ino = 0 OR
          NOT EXISTS (
            SELECT 1
            FROM scan_files inode_peer
            WHERE inode_peer.run_id = candidate.run_id
              AND inode_peer.dev = candidate.dev
              AND inode_peer.ino = candidate.ino
              AND inode_peer.hash IS NULL
              AND inode_peer.hash_attempted = 0
              AND inode_peer.hash_needed = 1
              AND inode_peer.path < candidate.path
          )
        )
        ${afterCursor}
      ORDER BY candidate.size, candidate.dev, candidate.ino, candidate.path
      LIMIT @limit
    `).all({
      run_id: runId,
      size: after ? Number(after.size) || 0 : 0,
      dev: after ? Number(after.dev) || 0 : 0,
      ino: after ? Number(after.ino) || 0 : 0,
      path: after && typeof after.path === "string" ? after.path : "",
      limit: Math.max(1, Math.min(1024, Number(limit) || 128))
    })
  }

  setStageHash(runId, filePath, hash) {
    const previewBefore = this.scanPreviewGroups(runId, [hash])
    const result = this.database.prepare(`
      UPDATE scan_files SET hash = ?, hash_attempted = 1
      WHERE run_id = ? AND path = ?
    `).run(hash, runId, path.resolve(filePath))
    return {
      changes: result.changes,
      preview: this.scanPreviewChange(runId, [hash], previewBefore)
    }
  }

  setStageInodeHash(runId, dev, ino, hash) {
    const previewBefore = this.scanPreviewGroups(runId, [hash])
    let result
    this.transaction(() => {
      result = this.database.prepare(`
        UPDATE scan_files SET hash = ?, hash_attempted = 1
        WHERE run_id = ? AND dev = ? AND ino = ? AND hash IS NULL
      `).run(hash, runId, dev, ino)
      this.checkScanAnchorsForInode(runId, dev, ino, hash)
    })
    return {
      changes: result.changes,
      preview: this.scanPreviewChange(runId, [hash], previewBefore)
    }
  }

  markStageHashFailed(runId, candidate) {
    const resolvedPath = path.resolve(candidate.path)
    let next = null
    let anchorFallback = false
    this.transaction(() => {
      this.database.prepare(`
        UPDATE scan_files SET hash_attempted = 1
        WHERE run_id = ? AND path = ?
      `).run(runId, resolvedPath)
      if (!(candidate.nlink > 1) || candidate.ino === 0) return
      next = this.database.prepare(`
        SELECT *
        FROM scan_files
        WHERE run_id = ?
          AND dev = ?
          AND ino = ?
          AND hash IS NULL
          AND hash_attempted = 0
          AND hash_needed = 1
        ORDER BY path
        LIMIT 1
      `).get(runId, candidate.dev, candidate.ino) || null
      if (next) return
      anchorFallback = !!this.database.prepare(`
        SELECT 1
        FROM scan_anchors
        WHERE run_id = ?
          AND dev = ?
          AND ino = ?
          AND verified_hash IS NULL
          AND verify_attempted = 0
        LIMIT 1
      `).get(runId, candidate.dev, candidate.ino)
    })
    return {
      next,
      anchor_fallback: anchorFallback
    }
  }

  unverifiedAnchorBatch(runId, limit = 64) {
    return this.database.prepare(`
      SELECT anchor.*
      FROM scan_anchors anchor
      WHERE anchor.run_id = ?
        AND anchor.verified_hash IS NULL
        AND anchor.verify_attempted = 0
        AND (
          anchor.nlink <= 1 OR
          anchor.ino = 0 OR
          NOT EXISTS (
            SELECT 1
            FROM scan_anchors inode_peer
            WHERE inode_peer.run_id = anchor.run_id
              AND inode_peer.dev = anchor.dev
              AND inode_peer.ino = anchor.ino
              AND inode_peer.verified_hash IS NULL
              AND inode_peer.verify_attempted = 0
              AND (
                inode_peer.store_id < anchor.store_id OR
                (
                  inode_peer.store_id = anchor.store_id AND
                  inode_peer.hash_name < anchor.hash_name
                )
              )
          )
        )
      ORDER BY anchor.store_id, anchor.hash_name
      LIMIT ?
    `).all(runId, limit)
  }

  publishScan(
    runId,
    sourceIds,
    metadata,
    stores = []
  ) {
    const sourceList = [...new Set(sourceIds.filter(Boolean))]
    const now = Date.now()
    this.transaction(() => {
      const insertStore = this.database.prepare(`
        INSERT INTO scan_stores (
          run_id, store_id, dev, can_link, root
        ) VALUES (?, ?, ?, ?, ?)
      `)
      for (const store of stores) {
        if (!store ||
            typeof store.store_id !== "string" ||
            !Number.isFinite(store.dev)) continue
        insertStore.run(
          runId,
          store.store_id,
          store.dev,
          store.can_link === false ? 0 : 1,
          path.resolve(store.root)
        )
      }

      this.database.prepare(`
        UPDATE scan_files AS candidate
        SET status = 'unavailable', unavailable_reason = 'anchor_conflict'
        WHERE candidate.run_id = ?
          AND candidate.status IS NULL
          AND candidate.hash IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM scan_anchors anchor
            WHERE anchor.run_id = candidate.run_id
              AND anchor.dev = candidate.dev
              AND anchor.hash_name = candidate.hash
              AND anchor.verify_attempted = 1
              AND anchor.verified_hash IS NULL
          )
      `).run(runId)

      this.database.prepare(`
        UPDATE scan_files AS candidate
        SET
          status = 'unavailable',
          unavailable_reason = CASE
            WHEN EXISTS (
              SELECT 1 FROM scan_stores store
              WHERE store.run_id = candidate.run_id
                AND store.dev = candidate.dev
            )
            THEN 'hardlinks'
            ELSE 'different_disk'
          END
        WHERE candidate.run_id = ?
          AND candidate.status IS NULL
          AND candidate.hash IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM scan_stores store
            WHERE store.run_id = candidate.run_id
              AND store.dev = candidate.dev
              AND store.can_link = 1
          )
          AND (
            EXISTS (
              SELECT 1 FROM scan_files peer
                WHERE peer.run_id = candidate.run_id
                  AND peer.hash = candidate.hash
                  AND peer.dev = candidate.dev
                  AND peer.path != candidate.path
              )
              OR EXISTS (
                SELECT 1 FROM scan_anchors anchor
                WHERE anchor.run_id = candidate.run_id
                  AND anchor.verified_hash = candidate.hash
                  AND anchor.dev = candidate.dev
              )
            )
      `).run(runId)

      this.database.prepare(`
        INSERT OR IGNORE INTO scan_linked_groups (
          run_id, hash, dev, mode_bits, uid, gid
        )
        SELECT
          run_id, hash, dev, (mode & 4095), uid, gid
        FROM scan_files
        WHERE run_id = ?
          AND status = 'linked'
          AND hash IS NOT NULL
        GROUP BY run_id, hash, dev, (mode & 4095), uid, gid
      `).run(runId)

      this.database.prepare(`
        INSERT OR IGNORE INTO scan_linked_groups (
          run_id, hash, dev, mode_bits, uid, gid
        )
        SELECT
          run_id, verified_hash, dev, (mode & 4095), uid, gid
        FROM scan_anchors
        WHERE run_id = ?
          AND verified_hash IS NOT NULL
      `).run(runId)

      this.database.prepare(`
        UPDATE scan_files AS candidate
        SET status = 'duplicate', unavailable_reason = NULL
        WHERE candidate.run_id = ?
          AND candidate.status IS NULL
          AND candidate.hash IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM scan_stores store
            WHERE store.run_id = candidate.run_id
              AND store.dev = candidate.dev
              AND store.can_link = 1
          )
          AND EXISTS (
            SELECT 1 FROM scan_linked_groups linked
            WHERE linked.run_id = candidate.run_id
              AND linked.hash = candidate.hash
              AND linked.dev = candidate.dev
              AND linked.mode_bits = (candidate.mode & 4095)
              AND linked.uid = candidate.uid
              AND linked.gid = candidate.gid
          )
      `).run(runId)

      this.database.prepare(`
        UPDATE scan_files AS candidate
        SET status = 'unavailable', unavailable_reason = 'metadata'
        WHERE candidate.run_id = ?
          AND candidate.status IS NULL
          AND candidate.hash IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM scan_stores store
            WHERE store.run_id = candidate.run_id
              AND store.dev = candidate.dev
              AND store.can_link = 1
          )
          AND EXISTS (
            SELECT 1 FROM scan_linked_groups linked
            WHERE linked.run_id = candidate.run_id
              AND linked.hash = candidate.hash
              AND linked.dev = candidate.dev
          )
      `).run(runId)

      this.database.prepare(`
        WITH metadata_groups AS (
          SELECT
            hash,
            dev,
            (mode & 4095) AS mode_bits,
            uid,
            gid,
            COUNT(*) AS file_count,
            MIN(path) AS representative_path
          FROM scan_files
          WHERE run_id = ?
            AND status IS NULL
            AND hash IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM scan_stores store
              WHERE store.run_id = scan_files.run_id
                AND store.dev = scan_files.dev
                AND store.can_link = 1
            )
          GROUP BY hash, dev, (mode & 4095), uid, gid
        ),
        chosen_groups AS (
          SELECT *
          FROM (
            SELECT metadata_groups.*,
              ROW_NUMBER() OVER (
                PARTITION BY hash, dev
                ORDER BY file_count DESC, representative_path
              ) AS group_rank
            FROM metadata_groups
          )
          WHERE group_rank = 1
        )
        UPDATE scan_files AS candidate
        SET
          status = CASE
            WHEN (candidate.mode & 4095) = chosen.mode_bits
              AND candidate.uid = chosen.uid
              AND candidate.gid = chosen.gid
            THEN CASE
              WHEN candidate.path = chosen.representative_path THEN NULL
              ELSE 'duplicate'
            END
            ELSE 'unavailable'
          END,
          unavailable_reason = CASE
            WHEN (candidate.mode & 4095) = chosen.mode_bits
              AND candidate.uid = chosen.uid
              AND candidate.gid = chosen.gid
            THEN NULL
            ELSE 'metadata'
          END
        FROM chosen_groups AS chosen
        WHERE candidate.run_id = ?
          AND candidate.status IS NULL
          AND candidate.hash = chosen.hash
          AND candidate.dev = chosen.dev
      `).run(runId, runId)

      this.database.prepare(`
        INSERT INTO content (hash, size, first_seen, verified_at)
        SELECT
          hash_name, size, ?,
          CASE WHEN verified_hash = hash_name THEN ? END
        FROM scan_anchors
        WHERE run_id = ? AND verified_hash = hash_name
        ON CONFLICT(hash) DO UPDATE SET
          size = excluded.size,
          verified_at = COALESCE(excluded.verified_at, content.verified_at)
      `).run(now, now, runId)

      this.database.prepare(`
        INSERT INTO content(hash, size, first_seen, verified_at)
        SELECT hash, MAX(size), ?, ?
        FROM scan_files
        WHERE run_id = ? AND hash IS NOT NULL
        GROUP BY hash
        ON CONFLICT(hash) DO UPDATE SET
          size = excluded.size,
          verified_at = excluded.verified_at
      `).run(now, now, runId)

      this.database.prepare(`
        DELETE FROM anchors
        WHERE store_id IN (
          SELECT store_id FROM scan_stores WHERE run_id = ?
        )
      `).run(runId)
      this.database.prepare(`
        INSERT INTO anchors (
          store_id, hash, path, verified_at, dev, ino, size, mtime, ctime,
          nlink, mode, uid, gid
        )
        SELECT
          store_id, hash_name, path, ?, dev, ino, size, mtime, ctime,
          nlink, mode, uid, gid
        FROM scan_anchors
        WHERE run_id = ? AND verified_hash = hash_name
      `).run(now, runId)

      this.dropFileTriggers()
      this.database.prepare(`
        UPDATE files
        SET
          unavailable_reason = 'stale',
          updated_at = ?
        WHERE EXISTS (
          SELECT 1 FROM scan_exclusions excluded
          WHERE excluded.run_id = ?
            AND (
              files.path = excluded.path OR
              substr(files.path, 1, length(excluded.prefix)) =
                excluded.prefix
            )
        )
      `).run(now, runId)

      this.database.prepare(`
        INSERT INTO files (
          path, hash, size, mtime, ctime, dev, ino, mode, uid, gid, source_id,
          app, status, unavailable_reason, updated_at
        )
        SELECT
          candidate.path,
          candidate.hash,
          candidate.size,
          candidate.mtime,
          candidate.ctime,
          candidate.dev,
          candidate.ino,
          candidate.mode,
          candidate.uid,
          candidate.gid,
          candidate.source_id,
          candidate.app,
          COALESCE(candidate.status, 'reference'),
          candidate.unavailable_reason,
          ?
        FROM scan_files candidate
        WHERE candidate.run_id = ?
        ON CONFLICT(path) DO UPDATE SET
          hash = excluded.hash,
          size = excluded.size,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          dev = excluded.dev,
          ino = excluded.ino,
          mode = excluded.mode,
          uid = excluded.uid,
          gid = excluded.gid,
          source_id = excluded.source_id,
          app = excluded.app,
          status = excluded.status,
          unavailable_reason = excluded.unavailable_reason,
          updated_at = excluded.updated_at
        WHERE
          files.hash IS NOT excluded.hash OR
          files.size != excluded.size OR
          files.mtime != excluded.mtime OR
          files.ctime != excluded.ctime OR
          files.dev != excluded.dev OR
          files.ino != excluded.ino OR
          files.mode != excluded.mode OR
          files.uid != excluded.uid OR
          files.gid != excluded.gid OR
          files.source_id IS NOT excluded.source_id OR
          files.app IS NOT excluded.app OR
          files.status != excluded.status OR
          files.unavailable_reason IS NOT excluded.unavailable_reason
      `).run(now, runId)

      if (!metadata.scope_id) {
        this.database.prepare(`
          DELETE FROM files
          WHERE NOT EXISTS (
            SELECT 1 FROM scan_files candidate
            WHERE candidate.run_id = ? AND candidate.path = files.path
          )
            AND NOT EXISTS (
              SELECT 1 FROM scan_exclusions excluded
              WHERE excluded.run_id = ?
                AND (
                  files.path = excluded.path OR
                  substr(files.path, 1, length(excluded.prefix)) =
                    excluded.prefix
                )
            )
        `).run(runId, runId)
      } else if (sourceList.length) {
        this.database.prepare(`
          DELETE FROM files
          WHERE source_id IN (${placeholders(sourceList)})
            AND NOT EXISTS (
              SELECT 1 FROM scan_files candidate
              WHERE candidate.run_id = ? AND candidate.path = files.path
            )
            AND NOT EXISTS (
              SELECT 1 FROM scan_exclusions excluded
              WHERE excluded.run_id = ?
                AND (
                  files.path = excluded.path OR
                  substr(files.path, 1, length(excluded.prefix)) =
                    excluded.prefix
                )
            )
        `).run(...sourceList, runId, runId)
      }
      this.rebuildFileSummaries()
      this.rebuildGroupSummaries()
      this.createFileTriggers()

      const scan = Object.assign({
        dirs: 0,
        files: 0,
        bytes_total: 0,
        candidates: 0,
        hashed: 0,
        hash_total: 0,
        hash_bytes: 0,
        inode_reuses: 0,
        unstable_hashes: 0,
        hash_failures: 0,
        duration_ms: 0,
        walk_duration_ms: 0,
        hash_wait_duration_ms: 0,
        hash_duration_ms: 0
      }, metadata)
      this.database.prepare(`
        INSERT INTO scans (
          scope_id, completed_at, dirs, files, bytes_total, candidates, hashed,
          hash_total, hash_bytes, inode_reuses, unstable_hashes, hash_failures,
          duration_ms, walk_duration_ms,
          hash_wait_duration_ms, hash_duration_ms, details
        ) VALUES (
          @scope_id, @completed_at, @dirs, @files, @bytes_total, @candidates,
          @hashed, @hash_total, @hash_bytes, @inode_reuses, @unstable_hashes,
          @hash_failures, @duration_ms, @walk_duration_ms,
          @hash_wait_duration_ms, @hash_duration_ms, @details
        )
        ON CONFLICT(scope_id) DO UPDATE SET
          completed_at = excluded.completed_at,
          dirs = excluded.dirs,
          files = excluded.files,
          bytes_total = excluded.bytes_total,
          candidates = excluded.candidates,
          hashed = excluded.hashed,
          hash_total = excluded.hash_total,
          hash_bytes = excluded.hash_bytes,
          inode_reuses = excluded.inode_reuses,
          unstable_hashes = excluded.unstable_hashes,
          hash_failures = excluded.hash_failures,
          duration_ms = excluded.duration_ms,
          walk_duration_ms = excluded.walk_duration_ms,
          hash_wait_duration_ms = excluded.hash_wait_duration_ms,
          hash_duration_ms = excluded.hash_duration_ms,
          details = excluded.details
      `).run({
        scope_id: metadata.scope_id || "",
        completed_at: now,
        dirs: scan.dirs,
        files: scan.files,
        bytes_total: scan.bytes_total,
        candidates: scan.candidates,
        hashed: scan.hashed,
        hash_total: scan.hash_total,
        hash_bytes: scan.hash_bytes,
        inode_reuses: scan.inode_reuses,
        unstable_hashes: scan.unstable_hashes,
        hash_failures: scan.hash_failures,
        duration_ms: scan.duration_ms,
        walk_duration_ms: scan.walk_duration_ms,
        hash_wait_duration_ms: scan.hash_wait_duration_ms,
        hash_duration_ms: scan.hash_duration_ms,
        details: JSON.stringify(metadata)
      })

      this.database.prepare(`
        DELETE FROM content
        WHERE NOT EXISTS (
          SELECT 1 FROM files WHERE files.hash = content.hash
        )
          AND NOT EXISTS (
            SELECT 1 FROM anchors WHERE anchors.hash = content.hash
          )
      `).run()
      this.rebuildSavings()
      this.resetScanSchema()
    })
    this.scanSizes.clear()
    this.scanInodes.clear()
    this.scanAnchorInodes.clear()
    this.scanHashWorkFiles = 0
    this.scanHashWorkBytes = 0
  }

  addEvent(event) {
    return this.transaction(() => {
      const result = this.database.prepare(`
        INSERT INTO events (
          created_at, kind, hash, path, app, source_id, bytes, file_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.ts || Date.now(),
        event.kind,
        event.hash || null,
        event.path ? path.resolve(event.path) : null,
        event.app || null,
        event.source_id || null,
        Number(event.bytes || event.bytes_saved || event.size) || 0,
        Math.max(1, Number(event.files || event.file_count) || 1)
      )
      this.trimEvents()
      this.rebuildActivitySummaries()
      return Number(result.lastInsertRowid)
    })
  }

  trimEvents() {
    this.database.prepare(`
      DELETE FROM events
      WHERE id <= COALESCE((SELECT MAX(id) - ? FROM events), 0)
    `).run(this.maxEvents)
  }

  setMaxEvents(value) {
    this.maxEvents = Math.max(1, Number(value) || 1)
    this.transaction(() => {
      this.trimEvents()
      this.rebuildActivitySummaries()
    })
  }

  firstFileForInode(hash, dev, ino) {
    return this.database.prepare(`
      SELECT path FROM files
      WHERE hash = ? AND dev = ? AND ino = ?
        AND unavailable_reason IS NOT 'stale'
      ORDER BY path
      LIMIT 1
    `).get(hash, dev, ino) || null
  }

  anchorCandidate(hash, dev, mode, uid, gid) {
    return this.database.prepare(`
      SELECT * FROM files
      WHERE hash = ? AND dev = ?
        AND status IN ('reference', 'linked')
        AND unavailable_reason IS NOT 'stale'
        AND (mode & 4095) = ?
        AND uid = ?
        AND gid = ?
      ORDER BY CASE status WHEN 'linked' THEN 0 ELSE 1 END, path
      LIMIT 1
    `).get(hash, dev, mode, uid, gid) || null
  }

  countActionFiles(status, sourceIds = []) {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (!ids.length) {
      const row = this.database.prepare(`
        SELECT COALESCE(SUM(file_count), 0) AS count
        FROM file_summaries
        WHERE status = ?
      `).get(status)
      return Number(row.count) || 0
    }
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(file_count), 0) AS count
      FROM file_summaries
      WHERE status = ?
        AND source_id IN (${placeholders(ids)})
    `).get(status, ...ids)
    return Number(row.count) || 0
  }

  matchingFileSummary(status, sourceIds = [], query = "") {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (!ids.length) return { count: 0, bytes: 0 }
    if (!query) {
      const row = this.database.prepare(`
        SELECT
          COALESCE(SUM(file_count), 0) AS count,
          COALESCE(SUM(bytes), 0) AS bytes
        FROM file_summaries
        WHERE status = ?
          AND source_id IN (${placeholders(ids)})
      `).get(status, ...ids)
      return {
        count: Number(row.count) || 0,
        bytes: Number(row.bytes) || 0
      }
    }
    const values = [status, ...ids]
    values.push(`%${String(query).toLowerCase()
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")}%`)
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
      FROM files
      WHERE status = ?
        AND source_id IN (${placeholders(ids)})
        AND unavailable_reason IS NOT 'stale'
        AND LOWER(path) LIKE ? ESCAPE '\\'
    `).get(...values)
    return {
      count: Number(row.count) || 0,
      bytes: Number(row.bytes) || 0
    }
  }

  fileBatch(
    status,
    sourceIds = [],
    cursor = "",
    limit = 100,
    query = ""
  ) {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (!ids.length) return []
    const values = [status, cursor, ...ids]
    let search = ""
    if (query) {
      search = "AND LOWER(path) LIKE ? ESCAPE '\\'"
      values.push(`%${String(query).toLowerCase()
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")}%`)
    }
    return this.database.prepare(`
      SELECT path FROM files
      WHERE status = ?
        AND path > ?
        AND source_id IN (${placeholders(ids)})
        AND unavailable_reason IS NOT 'stale'
        ${search}
      ORDER BY path
      LIMIT ?
    `).all(...values, limit)
  }

  hasFilesForHash(hash) {
    return !!this.database.prepare(
      "SELECT 1 FROM files WHERE hash = ? LIMIT 1"
    ).get(hash)
  }

  reclaimableBatch(cursor = "", limit = 100) {
    const decoded = typeof cursor === "object" && cursor
      ? cursor
      : { store_id: "", hash: String(cursor || "") }
    return this.database.prepare(`
      SELECT store_id, hash FROM anchors
      WHERE nlink = 1
        AND (store_id > ? OR (store_id = ? AND hash > ?))
      ORDER BY store_id, hash
      LIMIT ?
    `).all(
      decoded.store_id || "",
      decoded.store_id || "",
      decoded.hash || "",
      limit
    )
  }

  clearFiles() {
    this.transaction(() => {
      this.database.prepare("DELETE FROM files").run()
      this.rebuildSavings()
    })
  }

  externalSourceFilter(alias, sourceIds = []) {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    const column = alias ? `${alias}.source_id` : "source_id"
    return {
      where: `(${column} NOT LIKE 'external:%' OR ${column} IN (
        SELECT value FROM json_each(?)
      ))`,
      values: [JSON.stringify(ids)]
    }
  }

  summaryRows(sourceIds, unrestricted = false, externalSourceIds = []) {
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (!unrestricted && !ids.length) return []
    const external = this.externalSourceFilter(null, externalSourceIds)
    return this.database.prepare(`
      SELECT source_id, status, file_count, bytes
      FROM file_summaries
      WHERE ${unrestricted
        ? `${external.where} AND file_count > 0`
        : `source_id IN (${placeholders(ids)}) AND file_count > 0`}
    `).all(...(unrestricted ? external.values : ids))
  }

  activityCount(sourceIds, scoped) {
    if (!scoped) {
      return Number(this.database.prepare(`
        SELECT activity_count FROM global_summary WHERE id = 1
      `).get().activity_count) || 0
    }
    const ids = [...new Set(sourceIds.filter(Boolean))]
    if (!ids.length) return 0
    if (ids.length === 1) {
      const row = this.database.prepare(`
        SELECT activity_count
        FROM activity_summaries
        WHERE source_id = ?
      `).get(ids[0])
      return row ? Number(row.activity_count) || 0 : 0
    }
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(activity_count), 0) AS count
      FROM activity_summaries
      WHERE source_id IN (${placeholders(ids)})
    `).get(...ids)
    return Number(row.count) || 0
  }

  decodeCursor(value) {
    if (!value || typeof value !== "string") return null
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString())
      return parsed && typeof parsed === "object" ? parsed : null
    } catch (error) {
      return null
    }
  }

  encodeCursor(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url")
  }

  fileFilter(
    view,
    statusFilter,
    sourceIds,
    query,
    unrestricted = false,
    externalSourceIds = []
  ) {
    const where = ["unavailable_reason IS NOT 'stale'"]
    const values = []
    if (view === "duplicates") {
      where.push("status IN ('duplicate', 'unavailable')")
    } else if (view === "shared") {
      where.push("status = 'linked'")
    } else if (view === "tracked") {
      where.push("status = 'reference'")
    } else if (view === "all" && statusFilter !== "all") {
      const statuses = {
        duplicate: ["duplicate", "unavailable"],
        shared: ["linked"],
        tracked: ["reference"]
      }[statusFilter] || []
      where.push(`status IN (${placeholders(statuses)})`)
      values.push(...statuses)
    }
    if (unrestricted) {
      const external = this.externalSourceFilter(null, externalSourceIds)
      where.push(external.where)
      values.push(...external.values)
    } else if (sourceIds.length) {
      where.push(`source_id IN (${placeholders(sourceIds)})`)
      values.push(...sourceIds)
    } else {
      where.push("0")
    }
    if (query) {
      where.push("LOWER(path) LIKE ? ESCAPE '\\'")
      values.push(`%${String(query).toLowerCase()
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")}%`)
    }
    return { where, values }
  }

  duplicateGroupFilter(
    sourceIds,
    query,
    unrestricted,
    alias,
    statuses = ["duplicate", "unavailable"],
    externalSourceIds = []
  ) {
    const column = (name) => `${alias}.${name}`
    const where = [`${column("unavailable_reason")} IS NOT 'stale'`]
    const values = []
    if (statuses && statuses.length) {
      where.push(
        `${column("status")} IN (${placeholders(statuses)})`)
      values.push(...statuses)
    }
    if (unrestricted) {
      const external = this.externalSourceFilter(alias, externalSourceIds)
      where.push(external.where)
      values.push(...external.values)
    } else {
      if (sourceIds.length) {
        where.push(
          `${column("source_id")} IN (${placeholders(sourceIds)})`)
        values.push(...sourceIds)
      } else {
        where.push("0")
      }
    }
    if (query) {
      where.push(`LOWER(${column("path")}) LIKE ? ESCAPE '\\'`)
      values.push(`%${String(query).toLowerCase()
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")}%`)
    }
    return { where, values }
  }

  compareFileRows(left, right, sort) {
    if (sort === "asc" && left.size !== right.size) {
      return left.size < right.size ? -1 : 1
    }
    if (sort === "desc" && left.size !== right.size) {
      return left.size > right.size ? -1 : 1
    }
    const pathOrder = Buffer.compare(
      Buffer.from(left.path),
      Buffer.from(right.path)
    )
    return sort === "desc" ? -pathOrder : pathOrder
  }

  fileStreamRows(options) {
    const {
      sourceId,
      status,
      query,
      sort,
      cursor,
      limit,
      externalSourceIds
    } = options
    const where = ["unavailable_reason IS NOT 'stale'"]
    const values = []
    if (sourceId) {
      where.push("source_id = ?")
      values.push(sourceId)
    } else {
      const external = this.externalSourceFilter(null, externalSourceIds)
      where.push(external.where)
      values.push(...external.values)
    }
    if (status) {
      where.push("status = ?")
      values.push(status)
    }
    if (query) {
      where.push("LOWER(path) LIKE ? ESCAPE '\\'")
      values.push(`%${String(query).toLowerCase()
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")}%`)
    }
    if (cursor && typeof cursor.path === "string") {
      if (sort === "asc" && Number.isFinite(cursor.size)) {
        where.push("(size > ? OR (size = ? AND path > ?))")
        values.push(cursor.size, cursor.size, cursor.path)
      } else if (sort === "desc" && Number.isFinite(cursor.size)) {
        where.push("(size < ? OR (size = ? AND path < ?))")
        values.push(cursor.size, cursor.size, cursor.path)
      } else if (sort === "path") {
        where.push("path > ?")
        values.push(cursor.path)
      }
    }
    const order = sort === "asc"
      ? "size ASC, path ASC"
      : sort === "desc"
        ? "size DESC, path DESC"
        : "path ASC"
    return this.database.prepare(`
      SELECT * FROM files
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${order}
      LIMIT ?
    `).all(...values, limit)
  }

  boundedFileRows(options) {
    const {
      sourceIds,
      unrestricted,
      statuses,
      query,
      sort,
      cursor,
      pageSize,
      externalSourceIds
    } = options
    const sources = unrestricted
      ? [null]
      : [...new Set(sourceIds.filter(Boolean))]
    if (!sources.length) return []
    const allStatuses = [
      "reference", "duplicate", "linked", "unavailable"
    ]
    const statusStreams = statuses.length === allStatuses.length &&
      allStatuses.every((status) => statuses.includes(status))
      ? [null]
      : statuses
    if (!statusStreams.length) return []
    const decoded = this.decodeCursor(cursor)
    const initialCursor = decoded && decoded.sort === sort
      ? decoded
      : null
    const streams = sources.flatMap((sourceId) =>
      statusStreams.map((status) => ({
        sourceId,
        status,
        cursor: initialCursor,
        rows: [],
        exhausted: false
      })))
    const refill = (stream, limit) => {
      const rows = this.fileStreamRows({
        sourceId: stream.sourceId,
        status: stream.status,
        query,
        sort,
        cursor: stream.cursor,
        limit,
        externalSourceIds
      })
      stream.rows.push(...rows)
      if (rows.length < limit) stream.exhausted = true
      const last = rows[rows.length - 1]
      if (last) {
        stream.cursor = {
          sort,
          size: last.size,
          path: last.path
        }
      }
    }
    for (const stream of streams) refill(stream, 1)
    const result = []
    while (result.length < pageSize + 1) {
      let selected = null
      for (const stream of streams) {
        const row = stream.rows[0]
        if (!row) continue
        if (!selected ||
            this.compareFileRows(
              row, selected.rows[0], sort) < 0) {
          selected = stream
        }
      }
      if (!selected) break
      result.push(selected.rows.shift())
      if (!selected.rows.length && !selected.exhausted) {
        refill(selected, 16)
      }
    }
    return result
  }

  statusesForView(view, statusFilter) {
    if (view === "duplicates") return ["duplicate", "unavailable"]
    if (view === "shared") return ["linked"]
    if (view === "tracked") return ["reference"]
    if (view !== "all" || statusFilter === "all") {
      return ["reference", "duplicate", "linked", "unavailable"]
    }
    return {
      duplicate: ["duplicate", "unavailable"],
      shared: ["linked"],
      tracked: ["reference"]
    }[statusFilter] || []
  }

  filePage(options) {
    const {
      view,
      statusFilter,
      sourceIds,
      query,
      pageSize,
      sizeSort,
      cursor,
      unrestricted,
      externalSourceIds
    } = options
    const sort = sizeSort === "asc" || sizeSort === "desc"
      ? sizeSort
      : "path"
    const rows = this.boundedFileRows({
      sourceIds,
      unrestricted,
      statuses: this.statusesForView(view, statusFilter),
      query,
      sort,
      cursor,
      pageSize,
      externalSourceIds
    })
    const hasMore = rows.length > pageSize
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    const nextCursor = hasMore && last
      ? this.encodeCursor({
        sort,
        size: last.size,
        path: last.path
      })
      : null

    const hashes = [...new Set(rows
      .filter((row) => row.status !== "linked")
      .map((row) => row.hash)
      .filter(Boolean))]
    const hashSampleExternal = this.externalSourceFilter(
      "sample", externalSourceIds)
    const hashCountExternal = this.externalSourceFilter(
      "countable", externalSourceIds)
    const hashSiblings = hashes.length
      ? this.database.prepare(`
        WITH selected(hash) AS (
          VALUES ${hashes.map(() => "(?)").join(", ")}
        ),
        first_sample AS (
          SELECT selected.hash,
            (
              SELECT path FROM files sample
              WHERE sample.hash = selected.hash
                AND sample.unavailable_reason IS NOT 'stale'
                AND ${hashSampleExternal.where}
              ORDER BY path
              LIMIT 1
            ) AS first_path
          FROM selected
        ),
        samples AS (
          SELECT first_sample.*,
            (
              SELECT path FROM files sample
              WHERE sample.hash = first_sample.hash
                AND sample.path > first_sample.first_path
                AND sample.unavailable_reason IS NOT 'stale'
                AND ${hashSampleExternal.where}
              ORDER BY path
              LIMIT 1
            ) AS second_path
          FROM first_sample
        )
        SELECT files.*,
          (
            SELECT COUNT(*) FROM files countable
            WHERE countable.hash = files.hash
              AND countable.unavailable_reason IS NOT 'stale'
              AND ${hashCountExternal.where}
          ) AS location_count
        FROM samples
        JOIN files
          ON files.path = samples.first_path
          OR files.path = samples.second_path
        ORDER BY files.hash, files.path
      `).all(
        ...hashes,
        ...hashSampleExternal.values,
        ...hashSampleExternal.values,
        ...hashCountExternal.values
      )
      : []
    const linkedInodes = [...new Map(rows
      .filter((row) => row.status === "linked")
      .map((row) => [
        `${row.dev}:${row.ino}`,
        { dev: row.dev, ino: row.ino }
      ])).values()]
    const inodeSampleExternal = this.externalSourceFilter(
      "sample", externalSourceIds)
    const inodeCountExternal = this.externalSourceFilter(
      "countable", externalSourceIds)
    const inodeSiblings = linkedInodes.length
      ? this.database.prepare(`
        WITH selected(dev, ino) AS (
          VALUES ${linkedInodes.map(() => "(?, ?)").join(", ")}
        ),
        first_sample AS (
          SELECT selected.dev, selected.ino,
            (
              SELECT path FROM files sample
              WHERE sample.dev = selected.dev
                AND sample.ino = selected.ino
                AND sample.status = 'linked'
                AND sample.unavailable_reason IS NOT 'stale'
                AND ${inodeSampleExternal.where}
              ORDER BY path
              LIMIT 1
            ) AS first_path
          FROM selected
        ),
        samples AS (
          SELECT first_sample.*,
            (
              SELECT path FROM files sample
              WHERE sample.dev = first_sample.dev
                AND sample.ino = first_sample.ino
                AND sample.status = 'linked'
                AND sample.unavailable_reason IS NOT 'stale'
                AND sample.path > first_sample.first_path
                AND ${inodeSampleExternal.where}
              ORDER BY path
              LIMIT 1
            ) AS second_path
          FROM first_sample
        )
        SELECT files.*,
          (
            SELECT COUNT(*) FROM files countable
            WHERE countable.dev = files.dev
              AND countable.ino = files.ino
              AND countable.status = 'linked'
              AND countable.unavailable_reason IS NOT 'stale'
              AND ${inodeCountExternal.where}
          ) AS location_count
        FROM samples
        JOIN files
          ON files.path = samples.first_path
          OR files.path = samples.second_path
        ORDER BY files.dev, files.ino, files.path
      `).all(
        ...linkedInodes.flatMap((inode) => [inode.dev, inode.ino]),
        ...inodeSampleExternal.values,
        ...inodeSampleExternal.values,
        ...inodeCountExternal.values
      )
      : []
    return { rows, hashSiblings, inodeSiblings, nextCursor }
  }

  duplicateGroupPage(options = {}) {
    const sourceIds = [...new Set(
      (options.sourceIds || []).filter(Boolean))]
    const authorizedSourceIds = [...new Set(
      (options.authorizedSourceIds || []).filter(Boolean))]
    const externalSourceIds = [...new Set(
      (options.externalSourceIds || []).filter(Boolean))]
    const pageSize = Math.max(
      1, Math.min(500, Number(options.pageSize) || 500))
    const direction = options.sizeSort === "asc" ? "asc" : "desc"
    const active = this.duplicateGroupFilter(
      sourceIds,
      String(options.query || ""),
      !!options.unrestricted,
      "candidate",
      ["duplicate", "unavailable"],
      externalSourceIds
    )
    active.where.push("candidate.hash IS NOT NULL")
    const authorized = this.duplicateGroupFilter(
      authorizedSourceIds,
      "",
      !!options.authorizedUnrestricted,
      "visible",
      null,
      externalSourceIds
    )
    const decoded = this.decodeCursor(options.cursor)
    const cursorWhere = []
    const cursorValues = []
    if (decoded &&
        decoded.sort === `duplicate-groups-${direction}` &&
        Number.isFinite(decoded.size) &&
        typeof decoded.hash === "string") {
      cursorWhere.push(direction === "asc"
        ? "(content_group.size > ? OR (content_group.size = ? AND content_group.hash > ?))"
        : "(content_group.size < ? OR (content_group.size = ? AND content_group.hash > ?))")
      cursorValues.push(decoded.size, decoded.size, decoded.hash)
    }
    const order = direction === "asc"
      ? "content_group.size ASC, content_group.hash ASC"
      : "content_group.size DESC, content_group.hash ASC"
    const rows = this.database.prepare(`
      WITH content_group AS (
        SELECT
          candidate.hash,
          MAX(candidate.size) AS size,
          MIN(candidate.path) AS representative_path,
          SUM(CASE
            WHEN candidate.status = 'duplicate' THEN 1 ELSE 0
          END) AS eligible_count,
          COALESCE(SUM(CASE
            WHEN candidate.status = 'duplicate'
            THEN candidate.size ELSE 0
          END), 0) AS can_save
        FROM files candidate
        WHERE ${active.where.join(" AND ")}
        GROUP BY candidate.hash
      )
      SELECT
        content_group.*,
        representative.source_id AS representative_source_id,
        representative.app AS representative_app,
        (
          SELECT COUNT(*)
          FROM files visible
          WHERE visible.hash = content_group.hash
            AND ${authorized.where.join(" AND ")}
        ) AS total_count
      FROM content_group
      JOIN files representative
        ON representative.path = content_group.representative_path
      ${cursorWhere.length
        ? `WHERE ${cursorWhere.join(" AND ")}`
        : ""}
      ORDER BY ${order}
      LIMIT ?
    `).all(
      ...active.values,
      ...authorized.values,
      ...cursorValues,
      pageSize + 1
    )
    const hasMore = rows.length > pageSize
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    const total = Number(this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT candidate.hash
        FROM files candidate
        WHERE ${active.where.join(" AND ")}
        GROUP BY candidate.hash
      )
    `).get(...active.values).count) || 0
    return {
      rows,
      total,
      nextCursor: hasMore && last
        ? this.encodeCursor({
            sort: `duplicate-groups-${direction}`,
            size: Number(last.size) || 0,
            hash: last.hash
          })
        : null
    }
  }

  duplicateGroupChildren(options = {}) {
    const sourceIds = [...new Set(
      (options.sourceIds || []).filter(Boolean))]
    const activeSourceIds = [...new Set(
      (options.activeSourceIds || []).filter(Boolean))]
    const externalSourceIds = [...new Set(
      (options.externalSourceIds || []).filter(Boolean))]
    const pageSize = Math.max(
      1, Math.min(500, Number(options.pageSize) || 100))
    const authorized = this.duplicateGroupFilter(
      sourceIds,
      "",
      !!options.unrestricted,
      "child",
      null,
      externalSourceIds
    )
    const active = this.duplicateGroupFilter(
      activeSourceIds,
      String(options.query || ""),
      !!options.activeUnrestricted,
      "child",
      ["duplicate"],
      externalSourceIds
    )
    const decoded = this.decodeCursor(options.cursor)
    const cursorWhere = []
    const cursorValues = []
    if (decoded &&
        decoded.sort === "duplicate-children" &&
        decoded.hash === options.hash &&
        typeof decoded.path === "string") {
      cursorWhere.push("child.path > ?")
      cursorValues.push(decoded.path)
    }
    const rows = this.database.prepare(`
      SELECT child.*,
        CASE WHEN ${active.where.join(" AND ")}
          THEN 1 ELSE 0
        END AS selectable
      FROM files child
      WHERE child.hash = ?
        AND ${authorized.where.join(" AND ")}
        ${cursorWhere.length
          ? `AND ${cursorWhere.join(" AND ")}`
          : ""}
      ORDER BY child.path
      LIMIT ?
    `).all(
      ...active.values,
      options.hash,
      ...authorized.values,
      ...cursorValues,
      pageSize + 1
    )
    const hasMore = rows.length > pageSize
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    const total = Number(this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM files child
      WHERE child.hash = ?
        AND ${authorized.where.join(" AND ")}
    `).get(options.hash, ...authorized.values).count) || 0
    return {
      rows,
      total,
      nextCursor: hasMore && last
        ? this.encodeCursor({
            sort: "duplicate-children",
            hash: options.hash,
            path: last.path
          })
        : null
    }
  }

  duplicateGroupSelection(options = {}) {
    const sourceIds = [...new Set(
      (options.sourceIds || []).filter(Boolean))]
    const externalSourceIds = [...new Set(
      (options.externalSourceIds || []).filter(Boolean))]
    const active = this.duplicateGroupFilter(
      sourceIds,
      String(options.query || ""),
      !!options.unrestricted,
      "candidate",
      ["duplicate"],
      externalSourceIds
    )
    const rows = this.database.prepare(`
      SELECT candidate.path
      FROM files candidate
      WHERE candidate.hash = ?
        AND ${active.where.join(" AND ")}
      ORDER BY candidate.path
      LIMIT 501
    `).all(options.hash, ...active.values)
    return {
      paths: rows.slice(0, 500).map((row) => row.path),
      exceeded: rows.length > 500
    }
  }

  duplicateGroupPageSelection(options = {}) {
    const page = this.duplicateGroupPage(options)
    const hashes = page.rows
      .filter((row) => Number(row.eligible_count) > 0)
      .map((row) => row.hash)
    if (!hashes.length) return { items: [], exceeded: false }
    const sourceIds = [...new Set(
      (options.sourceIds || []).filter(Boolean))]
    const externalSourceIds = [...new Set(
      (options.externalSourceIds || []).filter(Boolean))]
    const active = this.duplicateGroupFilter(
      sourceIds,
      String(options.query || ""),
      !!options.unrestricted,
      "candidate",
      ["duplicate"],
      externalSourceIds
    )
    const rows = this.database.prepare(`
      SELECT candidate.path, candidate.hash, candidate.size
      FROM files candidate
      WHERE candidate.hash IN (${placeholders(hashes)})
        AND ${active.where.join(" AND ")}
      ORDER BY candidate.path
      LIMIT 501
    `).all(...hashes, ...active.values)
    return {
      items: rows.slice(0, 500),
      exceeded: rows.length > 500
    }
  }

  reclaimablePage(pageSize, cursor) {
    const decoded = this.decodeCursor(cursor)
    const where = ["nlink = 1"]
    const values = []
    if (decoded && decoded.sort === "reclaimable" &&
        Number.isFinite(decoded.size) &&
        typeof decoded.store_id === "string" &&
        typeof decoded.hash === "string") {
      where.push(`(
        size < ? OR
        (size = ? AND store_id > ?) OR
        (size = ? AND store_id = ? AND hash > ?)
      )`)
      values.push(
        decoded.size,
        decoded.size, decoded.store_id,
        decoded.size, decoded.store_id, decoded.hash
      )
    }
    const rows = this.database.prepare(`
      SELECT store_id, hash, size, nlink, 1 AS orphan
      FROM anchors
      WHERE ${where.join(" AND ")}
      ORDER BY size DESC, store_id, hash
      LIMIT ?
    `).all(...values, pageSize + 1)
    const hasMore = rows.length > pageSize
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    return {
      rows,
      nextCursor: hasMore && last
        ? this.encodeCursor({
          sort: "reclaimable",
          size: last.size,
          store_id: last.store_id,
          hash: last.hash
        })
        : null
    }
  }

  activityPage(sourceIds, scoped, query, pageSize, cursor) {
    const baseWhere = []
    const baseValues = []
    if (scoped && sourceIds.length) {
      baseWhere.push(`source_id IN (${placeholders(sourceIds)})`)
      baseValues.push(...sourceIds)
    } else if (scoped) {
      baseWhere.push("0")
    }
    if (query) {
      baseWhere.push(
        "(LOWER(COALESCE(path, '')) LIKE ? ESCAPE '\\' OR " +
        "LOWER(kind) LIKE ? ESCAPE '\\')"
      )
      const escaped = String(query).toLowerCase()
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")
      baseValues.push(`%${escaped}%`, `%${escaped}%`)
    }
    let total = null
    if (query) {
      total = Number(this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM events
        ${baseWhere.length ? `WHERE ${baseWhere.join(" AND ")}` : ""}
      `).get(...baseValues).count) || 0
    }
    const where = [...baseWhere]
    const values = [...baseValues]
    const decoded = this.decodeCursor(cursor)
    if (decoded && decoded.sort === "activity" &&
        Number.isFinite(decoded.id)) {
      where.push("id < ?")
      values.push(decoded.id)
    }
    const rows = this.database.prepare(`
      SELECT
        id,
        created_at AS ts,
        kind,
        hash,
        path,
        app,
        source_id,
        bytes AS bytes_saved,
        file_count AS files,
        CASE
          WHEN file_count > 1
          THEN 'batch' ELSE 'event'
        END AS activity_type
      FROM events
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?
    `).all(...values, pageSize + 1)
    const hasMore = rows.length > pageSize
    if (hasMore) rows.pop()
    const last = rows[rows.length - 1]
    return {
      rows,
      total,
      nextCursor: hasMore && last
        ? this.encodeCursor({ sort: "activity", id: last.id })
        : null
    }
  }

  statusSnapshot(options = {}) {
    const scopeSourceIds = [...new Set(
      (options.scopeSourceIds || []).filter(Boolean))]
    const locationSourceIds = [...new Set(
      (options.locationSourceIds || []).filter(Boolean))]
    const externalSourceIds = [...new Set(
      (options.externalSourceIds || []).filter(Boolean))]
    const view = options.view || "all"
    const statusFilter = options.statusFilter || "all"
    const query = String(options.query || "")
    const pageSize = Math.max(1, Math.min(500, Number(options.pageSize) || 500))
    const scopeRows = this.summaryRows(
      scopeSourceIds, !!options.scopeUnrestricted, externalSourceIds)
    const locationRows = this.summaryRows(
      locationSourceIds, !!options.locationUnrestricted, externalSourceIds)
    const currentDeduplicateBytes = locationRows
      .filter((row) => row.status === "duplicate")
      .reduce((sum, row) => sum + Number(row.bytes), 0)
    const countsByStatus = {}
    for (const row of scopeRows) {
      countsByStatus[row.status] =
        (countsByStatus[row.status] || 0) + Number(row.file_count)
    }
    const global = this.database.prepare(
      "SELECT * FROM global_summary WHERE id = 1"
    ).get()
    const counts = {
      all: ["reference", "duplicate", "linked", "unavailable"].reduce(
        (sum, status) => sum + (countsByStatus[status] || 0), 0),
      duplicates: (countsByStatus.duplicate || 0) +
        (countsByStatus.unavailable || 0),
      shared: countsByStatus.linked || 0,
      tracked: countsByStatus.reference || 0,
      reclaimable: options.scoped
        ? 0
        : Number(global.reclaimable_count) || 0,
      activity: this.activityCount(scopeSourceIds, !!options.scoped)
    }
    const pending = scopeRows
      .filter((row) => row.status === "duplicate")
      .reduce((sum, row) => sum + Number(row.bytes), 0)
    const shareableDuplicates = scopeRows
      .filter((row) => row.status === "duplicate")
      .reduce((sum, row) => sum + Number(row.file_count), 0)
    const duplicateLocations = new Set(scopeRows
      .filter((row) =>
        row.status === "duplicate" && Number(row.file_count) > 0)
      .map((row) => row.source_id)).size
    const savedExternal = this.externalSourceFilter(
      null, externalSourceIds)
    const saved = options.scopeUnrestricted
      ? Number(this.database.prepare(`
        SELECT COALESCE(SUM(bytes), 0) AS bytes
        FROM source_savings
        WHERE ${savedExternal.where}
      `).get(...savedExternal.values).bytes) || 0
      : scopeSourceIds.length
      ? Number(this.database.prepare(`
        SELECT COALESCE(SUM(bytes), 0) AS bytes
        FROM source_savings
        WHERE source_id IN (${placeholders(scopeSourceIds)})
      `).get(...scopeSourceIds).bytes) || 0
      : 0
    const selectedStatuses = this.statusesForView(view, statusFilter)
    let total = 0
    let currentLocations = 0
    let currentShareableBytes = 0
    let currentSeparateCount = 0
    let currentSeparateBytes = 0
    let pageTotal = null
    let page
    if (view === "reclaimable") {
      total = counts.reclaimable
      page = this.reclaimablePage(pageSize, options.cursor)
    } else if (view === "activity") {
      page = this.activityPage(
        scopeSourceIds,
        !!options.scoped,
        query,
        pageSize,
        options.cursor
      )
      total = page.total == null ? counts.activity : page.total
    } else {
      if (query) {
        const filter = this.fileFilter(
          view,
          statusFilter,
          locationSourceIds,
          query,
          !!options.locationUnrestricted,
          externalSourceIds
        )
        const row = this.database.prepare(`
          SELECT
            COUNT(*) AS count,
            COUNT(DISTINCT source_id) AS locations,
            COALESCE(SUM(
              CASE WHEN status = 'duplicate' THEN size ELSE 0 END
            ), 0) AS shareable_bytes,
            COALESCE(SUM(
              CASE WHEN status = 'linked' THEN 1 ELSE 0 END
            ), 0) AS separate_count,
            COALESCE(SUM(
              CASE WHEN status = 'linked' THEN size ELSE 0 END
            ), 0) AS separate_bytes
          FROM files
          WHERE ${filter.where.join(" AND ")}
        `).get(...filter.values)
        total = Number(row.count) || 0
        currentLocations = Number(row.locations) || 0
        currentShareableBytes = Number(row.shareable_bytes) || 0
        currentSeparateCount = Number(row.separate_count) || 0
        currentSeparateBytes = Number(row.separate_bytes) || 0
      } else {
        const selected = locationRows.filter((row) =>
          selectedStatuses.includes(row.status))
        total = selected.reduce(
          (sum, row) => sum + Number(row.file_count), 0)
        currentLocations = new Set(selected
          .filter((row) => Number(row.file_count) > 0)
          .map((row) => row.source_id)).size
        currentShareableBytes = selected
          .filter((row) => row.status === "duplicate")
          .reduce((sum, row) => sum + Number(row.bytes), 0)
        currentSeparateCount = selected
          .filter((row) => row.status === "linked")
          .reduce((sum, row) => sum + Number(row.file_count), 0)
        currentSeparateBytes = selected
          .filter((row) => row.status === "linked")
          .reduce((sum, row) => sum + Number(row.bytes), 0)
      }
      if (view === "duplicates" && options.groupDuplicates) {
        page = this.duplicateGroupPage({
          sourceIds: locationSourceIds,
          authorizedSourceIds: scopeSourceIds,
          query,
          pageSize,
          sizeSort: options.sizeSort,
          cursor: options.cursor,
          unrestricted: !!options.locationUnrestricted,
          authorizedUnrestricted: !!options.scopeUnrestricted,
          externalSourceIds
        })
        pageTotal = page.total
      } else {
        page = this.filePage({
          view,
          statusFilter,
          sourceIds: locationSourceIds,
          query,
          pageSize,
          sizeSort: options.sizeSort,
          cursor: options.cursor,
          unrestricted: !!options.locationUnrestricted,
          externalSourceIds
        })
      }
    }
    return {
      counts,
      scopeRows,
      pending,
      shareableDuplicates,
      duplicateLocations,
      reclaimable: options.scoped
        ? 0
        : Number(global.reclaimable_bytes) || 0,
      saved,
      total,
      pageTotal: pageTotal == null ? total : pageTotal,
      currentLocations,
      currentShareableBytes,
      currentDeduplicateBytes,
      currentSeparateCount,
      currentSeparateBytes,
      page
    }
  }

  countFiles(statuses = null, sourceIds = null) {
    const where = []
    const values = []
    if (statuses && statuses.length) {
      where.push(`status IN (${placeholders(statuses)})`)
      values.push(...statuses)
    }
    if (sourceIds && sourceIds.length) {
      where.push(`source_id IN (${placeholders(sourceIds)})`)
      values.push(...sourceIds)
    }
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(file_count), 0) AS count FROM file_summaries
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `).get(...values)
    return Number(row.count) || 0
  }
}

module.exports = RegistryCore
