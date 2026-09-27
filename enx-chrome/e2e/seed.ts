// Seeds the throwaway E2E enx-api database (E2E_DB_PATH) with the vocabulary
// the fixture pages use, so highlighting and lookups work without ECDICT.
//
// Highlighting needs both tables: `words` (the word is known to enx-api) and
// the signed-in user's `user_dicts` row with query_count > 0 (the word is
// being reviewed; see WordProcessor.isReviewable). A lookup of a word that is
// already in `words` is served locally and never reaches ECDICT.
//
// Written straight to SQLite rather than through a test-only endpoint:
// ADR-037 keeps enx-api free of test bypasses, and the DB is per-run anyway.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'test-fixtures'
)

/** Every distinct word on the fixture pages, lowercased. */
export function fixtureWords(): string[] {
  const words = new Set<string>()
  for (const file of readdirSync(FIXTURE_DIR)) {
    if (!file.endsWith('.html')) continue
    const text = readFileSync(join(FIXTURE_DIR, file), 'utf8')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
    for (const match of text.matchAll(/[A-Za-z][A-Za-z-]*/g)) {
      words.add(match[0].toLowerCase())
    }
  }
  return [...words].sort()
}

/** The seeded meaning of a word: unique per word, so tests can tell them apart. */
export const seededChinese = (word: string) => `测试释义:${word}`

/**
 * Upserts every fixture word into `words` and resets the E2E user's review
 * state for them, so each test starts from the same highlights no matter what
 * an earlier test marked known. Call after sign-in: enx-api creates the local
 * user (a random id) on the first authenticated request.
 */
export function seedVocabulary(dbPath = process.env.E2E_DB_PATH): void {
  if (!dbPath)
    throw new Error('E2E_DB_PATH is not set (see playwright.config.ts)')

  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA busy_timeout = 10000')

    // The per-run DB only ever sees the E2E user sign in.
    const users = db.prepare('SELECT id FROM users').all() as { id: string }[]
    if (users.length !== 1) {
      throw new Error(
        `expected exactly one user in the E2E DB after sign-in, found ${users.length}`
      )
    }
    const userId = users[0].id

    const now = Date.now()
    const upsertWord = db.prepare(
      `INSERT INTO words (id, english, chinese, pronunciation, created_at, updated_at, load_count)
       VALUES (?, ?, ?, '', ?, ?, 0)
       ON CONFLICT(english) DO UPDATE SET chinese = excluded.chinese, deleted_at = NULL`
    )
    const upsertUserDict = db.prepare(
      `INSERT OR REPLACE INTO user_dicts
         (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
       VALUES (?, (SELECT id FROM words WHERE english = ?), ?, 0, ?, ?)`
    )

    db.exec('BEGIN IMMEDIATE')
    fixtureWords().forEach((word, i) => {
      upsertWord.run(`e2e-word-${word}`, word, seededChinese(word), now, now)
      // 1..20 spreads the words over every review bucket (ADR-011 E1).
      upsertUserDict.run(userId, word, (i % 20) + 1, now, now)
    })
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}
