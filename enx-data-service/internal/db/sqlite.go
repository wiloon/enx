package db

import (
	"database/sql"
	"enx-data-service/internal/model"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	conn *sql.DB
}

func NewDatabase(dbPath string) (*Database, error) {
	conn, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Database{conn: conn}, nil
}

func (d *Database) Close() error {
	return d.conn.Close()
}

// CreateWord inserts a new word with UUID and timestamps
func (d *Database) CreateWord(word *model.Word) error {
	if word.ID == "" {
		word.ID = uuid.New().String()
	}
	now := time.Now().UnixMilli()
	word.CreatedAt = now
	word.UpdatedAt = now
	word.LoadCount = 0
	word.DeletedAt = nil

	query := `
		INSERT INTO words (id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := d.conn.Exec(query,
		word.ID,
		word.English,
		word.Chinese,
		word.Pronunciation,
		word.CreatedAt,
		word.LoadCount,
		word.UpdatedAt,
		word.DeletedAt,
	)
	return err
}

// GetWord retrieves a word by ID
func (d *Database) GetWord(id string) (*model.Word, error) {
	query := `
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words WHERE id = ? AND deleted_at IS NULL
	`
	row := d.conn.QueryRow(query, id)

	var word model.Word
	var chinese, pronunciation sql.NullString
	var deletedAt sql.NullInt64

	err := row.Scan(
		&word.ID,
		&word.English,
		&chinese,
		&pronunciation,
		&word.CreatedAt,
		&word.LoadCount,
		&word.UpdatedAt,
		&deletedAt,
	)
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

	return &word, nil
}

// UpdateWord updates an existing word and sets updated_at
func (d *Database) UpdateWord(word *model.Word) error {
	word.UpdatedAt = time.Now().UnixMilli()

	query := `
		UPDATE words 
		SET english = ?, chinese = ?, pronunciation = ?, load_count = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`
	_, err := d.conn.Exec(query,
		word.English,
		word.Chinese,
		word.Pronunciation,
		word.LoadCount,
		word.UpdatedAt,
		word.ID,
	)
	return err
}

// DeleteWord soft deletes a word by setting deleted_at
func (d *Database) DeleteWord(id string) error {
	now := time.Now().UnixMilli()
	query := `
		UPDATE words 
		SET deleted_at = ?, updated_at = ?
		WHERE id = ? AND deleted_at IS NULL
	`
	_, err := d.conn.Exec(query, now, now, id)
	return err
}

// ListWords retrieves words with pagination (excludes soft-deleted)
func (d *Database) ListWords(limit, offset int) ([]*model.Word, int, error) {
	// Get total count
	var total int
	countQuery := `SELECT COUNT(*) FROM words WHERE deleted_at IS NULL`
	if err := d.conn.QueryRow(countQuery).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Get paginated results
	query := `
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words 
		WHERE deleted_at IS NULL
		ORDER BY updated_at DESC
		LIMIT ? OFFSET ?
	`
	rows, err := d.conn.Query(query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var words []*model.Word
	for rows.Next() {
		var word model.Word
		var chinese, pronunciation sql.NullString
		var deletedAt sql.NullInt64

		if err := rows.Scan(
			&word.ID,
			&word.English,
			&chinese,
			&pronunciation,
			&word.CreatedAt,
			&word.LoadCount,
			&word.UpdatedAt,
			&deletedAt,
		); err != nil {
			return nil, 0, err
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

		words = append(words, &word)
	}

	return words, total, nil
}

// SyncWords retrieves all words changed after a given timestamp (includes soft-deleted)
func (d *Database) SyncWords(sinceTimestamp int64) ([]*model.Word, error) {
	query := `
		SELECT id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at
		FROM words 
		WHERE updated_at > ?
		ORDER BY updated_at ASC
	`
	rows, err := d.conn.Query(query, sinceTimestamp)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []*model.Word
	for rows.Next() {
		var word model.Word
		var chinese, pronunciation sql.NullString
		var deletedAt sql.NullInt64

		if err := rows.Scan(
			&word.ID,
			&word.English,
			&chinese,
			&pronunciation,
			&word.CreatedAt,
			&word.LoadCount,
			&word.UpdatedAt,
			&deletedAt,
		); err != nil {
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

		words = append(words, &word)
	}

	return words, nil
}

// GetUserDict retrieves user dictionary entry
func (d *Database) GetUserDict(userId, wordId string) (*model.UserDict, error) {
	query := `
		SELECT user_id, word_id, query_count, already_acquainted, created_at, updated_at
		FROM user_dicts WHERE user_id = ? AND word_id = ?
	`
	row := d.conn.QueryRow(query, userId, wordId)

	var userDict model.UserDict
	err := row.Scan(
		&userDict.UserId,
		&userDict.WordId,
		&userDict.QueryCount,
		&userDict.AlreadyAcquainted,
		&userDict.CreatedAt,
		&userDict.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user dict not found for user_id=%s, word_id=%s", userId, wordId)
	}
	if err != nil {
		return nil, err
	}

	return &userDict, nil
}

// UpsertUserDict creates or updates user dictionary entry
func (d *Database) UpsertUserDict(userDict *model.UserDict) error {
	now := time.Now().UnixMilli()

	// Check if entry exists
	existing, err := d.GetUserDict(userDict.UserId, userDict.WordId)
	if err != nil && err.Error() != fmt.Sprintf("user dict not found for user_id=%s, word_id=%s", userDict.UserId, userDict.WordId) {
		return err
	}

	if existing != nil {
		// Update existing entry
		userDict.UpdatedAt = now
		query := `
			UPDATE user_dicts 
			SET query_count = ?, already_acquainted = ?, updated_at = ?
			WHERE user_id = ? AND word_id = ?
		`
		_, err := d.conn.Exec(query,
			userDict.QueryCount,
			userDict.AlreadyAcquainted,
			userDict.UpdatedAt,
			userDict.UserId,
			userDict.WordId,
		)
		return err
	}

	// Insert new entry
	userDict.CreatedAt = now
	userDict.UpdatedAt = now
	query := `
		INSERT INTO user_dicts (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`
	_, err = d.conn.Exec(query,
		userDict.UserId,
		userDict.WordId,
		userDict.QueryCount,
		userDict.AlreadyAcquainted,
		userDict.CreatedAt,
		userDict.UpdatedAt,
	)
	return err
}
