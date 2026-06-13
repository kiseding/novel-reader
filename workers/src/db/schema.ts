// D1 database helpers
import type { D1Database } from "@cloudflare/workers-types";
import { hashPassword } from "../auth/password";

export async function initSchema(db: D1Database): Promise<void> {
  // D1 does not support db.exec() — execute each statement individually
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS bookshelf (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    latest_chapter TEXT NOT NULL DEFAULT '',
    chapter_index INTEGER NOT NULL DEFAULT 0,
    chapter_id TEXT NOT NULL DEFAULT '',
    chapter_title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, site, book_id)
  )`).run();

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_bookshelf_user ON bookshelf(user_id)`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    chapter_id TEXT NOT NULL DEFAULT '',
    chapter_title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, site, book_id)
  )`).run();

  // Migration: legacy schema had only created_at (which actually stored last-read time).
  // Add last_read_at if missing and backfill from created_at.
  try {
    const cols = await db.prepare("PRAGMA table_info(history)").all<{ name: string }>();
    const hasLastRead = cols.results.some((r) => r.name === "last_read_at");
    if (!hasLastRead) {
      await db.prepare(`ALTER TABLE history ADD COLUMN last_read_at TEXT NOT NULL DEFAULT ''`).run();
      await db.prepare(`UPDATE history SET last_read_at = created_at WHERE last_read_at = ''`).run();
    }
  } catch (e) {
    console.error("history.last_read_at migration failed:", (e as Error).message);
  }
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

export interface BookshelfRow {
  id: number;
  user_id: number;
  site: string;
  book_id: string;
  title: string;
  author: string;
  cover_url: string;
  description: string;
  source_url: string;
  latest_chapter: string;
  chapter_index: number;
  chapter_id: string;
  chapter_title: string;
  created_at: string;
  updated_at: string;
}

export async function createUser(
  db: D1Database,
  username: string,
  passwordHash: string
): Promise<UserRow> {
  const result = await db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING *")
    .bind(username, passwordHash)
    .first<UserRow>();
  if (!result) throw new Error("创建用户失败");
  return result;
}

export async function getUserByUsername(
  db: D1Database,
  username: string
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();
}

export async function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
}

export async function listBookshelf(
  db: D1Database,
  userId: number
): Promise<BookshelfRow[]> {
  const result = await db
    .prepare("SELECT * FROM bookshelf WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId)
    .all<BookshelfRow>();
  return result.results;
}

export async function getBookshelfItem(
  db: D1Database,
  userId: number,
  site: string,
  bookId: string
): Promise<BookshelfRow | null> {
  return db
    .prepare("SELECT * FROM bookshelf WHERE user_id = ? AND site = ? AND book_id = ?")
    .bind(userId, site, bookId)
    .first<BookshelfRow>();
}

export async function addToBookshelf(
  db: D1Database,
  userId: number,
  book: {
    site: string;
    bookId: string;
    title: string;
    author: string;
    coverUrl: string;
    description: string;
    sourceUrl: string;
  }
): Promise<BookshelfRow> {
  const result = await db
    .prepare(
      `INSERT INTO bookshelf (user_id, site, book_id, title, author, cover_url, description, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, site, book_id) DO UPDATE SET
         title = excluded.title, author = excluded.author,
         cover_url = excluded.cover_url, description = excluded.description,
         updated_at = datetime('now')
       RETURNING *`
    )
    .bind(userId, book.site, book.bookId, book.title, book.author, book.coverUrl, book.description, book.sourceUrl)
    .first<BookshelfRow>();
  if (!result) throw new Error("加入书架失败");
  return result;
}

export async function removeFromBookshelf(
  db: D1Database,
  userId: number,
  site: string,
  bookId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM bookshelf WHERE user_id = ? AND site = ? AND book_id = ?")
    .bind(userId, site, bookId)
    .run();
  return result.meta.changes > 0;
}

export async function updateReadingProgress(
  db: D1Database,
  userId: number,
  site: string,
  bookId: string,
  chapterIndex: number,
  chapterId: string,
  chapterTitle: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE bookshelf SET chapter_index = ?, chapter_id = ?, chapter_title = ?, updated_at = datetime('now')
       WHERE user_id = ? AND site = ? AND book_id = ?`
    )
    .bind(chapterIndex, chapterId, chapterTitle, userId, site, bookId)
    .run();
}

// Create default admin account if no users exist
export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const result = await db.prepare("SELECT id, username, password_hash, created_at FROM users ORDER BY id").all<UserRow>();
  return result.results;
}

export async function deleteUser(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

export async function updateUserPassword(db: D1Database, id: number, hash: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, id).run();
}

// ====== History ======
export async function addHistory(db: D1Database, userId: number, book: { site: string; bookId: string; title: string; author: string; coverUrl: string; chapterId: string; chapterTitle: string }): Promise<void> {
  await db.prepare(`INSERT INTO history (user_id, site, book_id, title, author, cover_url, chapter_id, chapter_title, last_read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, site, book_id) DO UPDATE SET
      title = excluded.title, author = excluded.author, cover_url = excluded.cover_url,
      chapter_id = excluded.chapter_id, chapter_title = excluded.chapter_title, last_read_at = datetime('now')`).bind(userId, book.site, book.bookId, book.title, book.author, book.coverUrl, book.chapterId, book.chapterTitle).run();
  // Keep only latest 30 by last_read_at
  await db.prepare(`DELETE FROM history WHERE user_id = ? AND id NOT IN (SELECT id FROM history WHERE user_id = ? ORDER BY last_read_at DESC LIMIT 30)`).bind(userId, userId).run();
}

export async function listHistory(db: D1Database, userId: number): Promise<any[]> {
  return (await db.prepare("SELECT * FROM history WHERE user_id = ? ORDER BY last_read_at DESC LIMIT 30").bind(userId).all()).results;
}

// ====== Admin ======
export async function ensureAdmin(db: D1Database): Promise<void> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM users")
    .first<{ count: number }>();
  if (result && result.count > 0) return;

  const hash = await hashPassword("admin123");
  await db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .bind("admin", hash)
    .run();
}
