package repository

import (
	"database/sql"
	"fmt"

	"enx-data-service/internal/model"

	_ "github.com/mattn/go-sqlite3"
)

type WordRepository struct {
	db *sql.DB
}

func NewWordRepository(dbPath string) (*WordRepository, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS words (
			id TEXT PRIMARY KEY,
			english TEXT NOT NULL UNIQUE,
			chinese TEXT,
			pronunciation TEXT,
			created_at INTEGER,
			load_count INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		)
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to create table: %w", err)
	}

	// Create sync_state table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS sync_state (
			peer_addr TEXT PRIMARY KEY,
			last_sync_time INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to create sync_state table: %w", err)
	}

	return &WordRepository{db: db}, nil
}

func (r *WordRepository) Close() error {
	return r.db.Close()
}

func (r *WordRepository) Create(word *model.Word) error {
	chinese := sql.NullString{}
	if word.Chinese != nil {
		chinese = sql.NullString{String: *word.Chinese, Valid: true}
	}

	pronunciation := sql.NullString{}
	if word.Pronunciation != nil {
		pronunciation = sql.NullString{String: *word.Pronunciation, Valid: true}
	}

	_, err := r.db.Exec(`
		INSERT INTO words (id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, word.ID, word.English, chinese, pronunciation, word.CreatedAt, word.LoadCount, word.UpdatedAt, word.DeletedAt)

	return err
}

func (r *WordRepository) Update(word *model.Word) error {
	chinese := sql.NullString{}
	if word.Chinese != nil {
		chinese = sql.NullString{String: *word.Chinese, Valid: true}
	}

	pronunciation := sql.NullString{}
	if word.Pronunciation != nil {
		pronunciation = sql.NullString{String: *word.Pronunciation, Valid: true}
	}

	_, err := r.db.Exec(`
		UPDATE words 
		SET english = ?, chinese = ?, pronunciation = ?, load_count = ?, updated_at = ?, deleted_at = ?
		WHERE id = ?
	`, word.English, chinese, pronunciation, word.LoadCount, word.UpdatedAt, word.DeletedAt, word.ID)

	return err
}

func (r *WordRepository) SoftDelete(id string, deletedAt int64) error {
	_, err := r.db.Exec(`UPDATE words SET deleted_at = ? WHERE id = ?`, deletedAt, id)
	return err
}

func (r *WordRepository) FindByID(id string) (*model.Word, error) {
	word := &model.Word{}
	var chinese, pronunciation sql.NullString
	var deletedAt sql.NullInt64

	err := r.db.QueryRow(`
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words WHERE id = ?
	`, id).Scan(&word.ID, &word.English, &chinese, &pronunciation, &word.CreatedAt, &word.LoadCount, &word.UpdatedAt, &deletedAt)

	if err != nil {
		return nil, err
	}

	if chinese.Valid {
		word.Chinese = &chinese.String
	}
	if pronunciation.Valid {
		word.Pronunciation = &pronunciation.String
	}
	if deletedAt.Valid {
		word.DeletedAt = &deletedAt.Int64
	}

	return word, nil
}

func (r *WordRepository) FindAll() ([]*model.Word, error) {
	rows, err := r.db.Query(`
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words WHERE deleted_at IS NULL
		ORDER BY english
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []*model.Word
	for rows.Next() {
		word := &model.Word{}
		var chinese, pronunciation sql.NullString
		var deletedAt sql.NullInt64

		err := rows.Scan(&word.ID, &word.English, &chinese, &pronunciation, &word.CreatedAt, &word.LoadCount, &word.UpdatedAt, &deletedAt)
		if err != nil {
			return nil, err
		}

		if chinese.Valid {
			word.Chinese = &chinese.String
		}
		if pronunciation.Valid {
			word.Pronunciation = &pronunciation.String
		}
		if deletedAt.Valid {
			word.DeletedAt = &deletedAt.Int64
		}

		words = append(words, word)
	}

	return words, nil
}

// GetLastSyncTime retrieves the last sync timestamp for a peer
func (r *WordRepository) GetLastSyncTime(peerAddr string) (int64, error) {
	var lastSyncTime int64
	err := r.db.QueryRow(`
		SELECT last_sync_time FROM sync_state WHERE peer_addr = ?
	`, peerAddr).Scan(&lastSyncTime)

	if err == sql.ErrNoRows {
		return 0, nil // No previous sync
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get last sync time: %w", err)
	}

	return lastSyncTime, nil
}

// UpdateLastSyncTime updates the last sync timestamp for a peer
func (r *WordRepository) UpdateLastSyncTime(peerAddr string, timestamp int64) error {
	now := timestamp
	_, err := r.db.Exec(`
		INSERT INTO sync_state (peer_addr, last_sync_time, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(peer_addr) DO UPDATE SET
			last_sync_time = excluded.last_sync_time,
			updated_at = excluded.updated_at
	`, peerAddr, timestamp, now)

	if err != nil {
		return fmt.Errorf("failed to update last sync time: %w", err)
	}

	return nil
}

func (r *WordRepository) FindByEnglish(english string) (*model.Word, error) {
	word := &model.Word{}
	var chinese, pronunciation sql.NullString
	var deletedAt sql.NullInt64

	err := r.db.QueryRow(`
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words WHERE english = ? AND deleted_at IS NULL
	`, english).Scan(&word.ID, &word.English, &chinese, &pronunciation, &word.CreatedAt, &word.LoadCount, &word.UpdatedAt, &deletedAt)

	if err != nil {
		return nil, err
	}

	if chinese.Valid {
		word.Chinese = &chinese.String
	}
	if pronunciation.Valid {
		word.Pronunciation = &pronunciation.String
	}
	if deletedAt.Valid {
		word.DeletedAt = &deletedAt.Int64
	}

	return word, nil
}

func (r *WordRepository) FindModifiedSince(timestamp int64) ([]*model.Word, error) {
	rows, err := r.db.Query(`
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words WHERE updated_at > ?
		ORDER BY updated_at DESC
	`, timestamp)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []*model.Word
	for rows.Next() {
		word := &model.Word{}
		var chinese, pronunciation sql.NullString
		var deletedAt sql.NullInt64

		err := rows.Scan(&word.ID, &word.English, &chinese, &pronunciation, &word.CreatedAt, &word.LoadCount, &word.UpdatedAt, &deletedAt)
		if err != nil {
			return nil, err
		}

		if chinese.Valid {
			word.Chinese = &chinese.String
		}
		if pronunciation.Valid {
			word.Pronunciation = &pronunciation.String
		}
		if deletedAt.Valid {
			word.DeletedAt = &deletedAt.Int64
		}

		words = append(words, word)
	}

	return words, nil
}
