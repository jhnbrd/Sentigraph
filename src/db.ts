import Database from 'better-sqlite3';
import { randomUUID, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import path from 'node:path';

export type ThemeVariant = 'broadside' | 'minimal' | 'modern';
export type ColorMode = 'dark' | 'light';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  feed_mode: 'latest' | 'curated';
  theme_variant: ThemeVariant;
  color_mode: ColorMode;
  created_at: string;
}

export interface Sentiment {
  id: string;
  user_id: string;
  author_alias: string;
  content: string;
  is_pinned: number; // 0 or 1
  pin_order: number; // 1 to 5, or 0
  is_hidden: number; // 0 or 1
  created_at: string;
}

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'sentigraph.db');
export const db = new Database(DB_PATH);

// Critical Performance & Concurrency Pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    feed_mode TEXT DEFAULT 'latest' CHECK(feed_mode IN ('latest', 'curated')),
    theme_variant TEXT DEFAULT 'broadside' CHECK(theme_variant IN ('broadside', 'minimal', 'modern')),
    color_mode TEXT DEFAULT 'dark' CHECK(color_mode IN ('dark', 'light')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sentiments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    author_alias TEXT DEFAULT 'Anonymous',
    content TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    pin_order INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sentiments_lookup 
  ON sentiments(user_id, is_hidden, is_pinned, pin_order, created_at);
`);

// Safe column migrations in case users table already existed
try {
  db.exec("ALTER TABLE users ADD COLUMN theme_variant TEXT DEFAULT 'broadside' CHECK(theme_variant IN ('broadside', 'minimal', 'modern'))");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN color_mode TEXT DEFAULT 'dark' CHECK(color_mode IN ('dark', 'light'))");
} catch {}

// Authentication Helpers (zero external crypto dependencies)
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  try {
    const [salt, key] = combinedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

// Prepared Statements for high efficiency and low memory footprint
const findUserByUsernameStmt = db.prepare<[string], User>(
  'SELECT * FROM users WHERE username = ? COLLATE NOCASE'
);

const findUserByIdStmt = db.prepare<[string], User>(
  'SELECT * FROM users WHERE id = ?'
);

const createUserStmt = db.prepare<[string, string, string, string, string, string]>(
  'INSERT INTO users (id, username, password_hash, feed_mode, theme_variant, color_mode) VALUES (?, ?, ?, ?, ?, ?)'
);

const updateUserFeedModeStmt = db.prepare<[string, string]>(
  'UPDATE users SET feed_mode = ? WHERE id = ?'
);

const updateUserThemeStmt = db.prepare<[string, string, string]>(
  'UPDATE users SET theme_variant = ?, color_mode = ? WHERE id = ?'
);

const insertSentimentStmt = db.prepare<[string, string, string, string]>(
  'INSERT INTO sentiments (id, user_id, author_alias, content) VALUES (?, ?, ?, ?)'
);

const getLatestSentimentsStmt = db.prepare<[string, number], Sentiment>(
  `SELECT * FROM sentiments 
   WHERE user_id = ? AND is_hidden = 0 
   ORDER BY created_at DESC 
   LIMIT ?`
);

const getCuratedPinnedStmt = db.prepare<[string], Sentiment>(
  `SELECT * FROM sentiments 
   WHERE user_id = ? AND is_hidden = 0 AND is_pinned = 1 
   ORDER BY pin_order ASC, created_at DESC 
   LIMIT 5`
);

const getAllSentimentsForUserStmt = db.prepare<[string], Sentiment>(
  `SELECT * FROM sentiments 
   WHERE user_id = ? 
   ORDER BY is_pinned DESC, pin_order ASC, created_at DESC`
);

const updateSentimentModerationStmt = db.prepare<[number, string, string]>(
  'UPDATE sentiments SET is_hidden = ? WHERE id = ? AND user_id = ?'
);

const updateSentimentPinStmt = db.prepare<[number, number, string, string]>(
  'UPDATE sentiments SET is_pinned = ?, pin_order = ? WHERE id = ? AND user_id = ?'
);

const deleteSentimentStmt = db.prepare<[string, string]>(
  'DELETE FROM sentiments WHERE id = ? AND user_id = ?'
);

// Typed Query Functions
export const queries = {
  getUserByUsername(username: string): User | undefined {
    return findUserByUsernameStmt.get(username);
  },

  getUserById(id: string): User | undefined {
    return findUserByIdStmt.get(id);
  },

  createUser(
    username: string, 
    passwordHash: string, 
    feedMode: 'latest' | 'curated' = 'latest',
    themeVariant: ThemeVariant = 'broadside',
    colorMode: ColorMode = 'dark'
  ): User {
    const id = randomUUID();
    createUserStmt.run(id, username, passwordHash, feedMode, themeVariant, colorMode);
    return {
      id,
      username,
      password_hash: passwordHash,
      feed_mode: feedMode,
      theme_variant: themeVariant,
      color_mode: colorMode,
      created_at: new Date().toISOString()
    };
  },

  updateFeedMode(userId: string, feedMode: 'latest' | 'curated'): void {
    updateUserFeedModeStmt.run(feedMode, userId);
  },

  updateTheme(userId: string, themeVariant: ThemeVariant, colorMode: ColorMode): void {
    updateUserThemeStmt.run(themeVariant, colorMode, userId);
  },

  addSentiment(userId: string, authorAlias: string, content: string): Sentiment {
    const id = randomUUID();
    const cleanAlias = (authorAlias || 'Anonymous').trim().slice(0, 32) || 'Anonymous';
    const cleanContent = content.trim().slice(0, 180);
    insertSentimentStmt.run(id, userId, cleanAlias, cleanContent);
    return {
      id,
      user_id: userId,
      author_alias: cleanAlias,
      content: cleanContent,
      is_pinned: 0,
      pin_order: 0,
      is_hidden: 0,
      created_at: new Date().toISOString()
    };
  },

  getSentimentsForCard(userId: string, feedMode: 'latest' | 'curated'): Sentiment[] {
    if (feedMode === 'curated') {
      const pinned = getCuratedPinnedStmt.all(userId);
      if (pinned.length >= 5) {
        return pinned.slice(0, 5);
      }

      // Backfill up to 5 sentiments with recent unpinned & unhidden entries
      const needed = 5 - pinned.length;
      const pinnedIds = pinned.map((s) => s.id);
      
      const allLatest = getLatestSentimentsStmt.all(userId, 10);
      const backfill = allLatest.filter((s) => !pinnedIds.includes(s.id)).slice(0, needed);
      return [...pinned, ...backfill];
    }

    return getLatestSentimentsStmt.all(userId, 5);
  },

  getAllSentimentsForUser(userId: string): Sentiment[] {
    return getAllSentimentsForUserStmt.all(userId);
  },

  setHidden(userId: string, sentimentId: string, isHidden: boolean): void {
    updateSentimentModerationStmt.run(isHidden ? 1 : 0, sentimentId, userId);
  },

  setPin(userId: string, sentimentId: string, isPinned: boolean, pinOrder: number = 0): void {
    updateSentimentPinStmt.run(isPinned ? 1 : 0, pinOrder, sentimentId, userId);
  },

  deleteSentiment(userId: string, sentimentId: string): void {
    deleteSentimentStmt.run(sentimentId, userId);
  }
};
