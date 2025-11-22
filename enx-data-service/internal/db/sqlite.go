package db

import (
	"database/sql"
	"enx-data-service/internal/model"
	"fmt"
	"os"
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

func (d *Database) InitSchema(schemaPath string) error {
	schema, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("failed to read schema file: %w", err)
	}

	if _, err := d.conn.Exec(string(schema)); err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}

	return nil
}

func (d *Database) Close() error {
	return d.conn.Close()
}

func (d *Database) CreateWord(word *model.Word) error {
	if word.ID == "" {
		word.ID = uuid.New().String()
	}
	word.UpdateDatetime = time.Now().UTC()
	word.IsDeleted = false

	query := `
		INSERT INTO words (id, english, chinese, phonetic, definition, update_datetime, is_deleted)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err := d.conn.Exec(query, word.ID, word.English, word.Chinese, word.Phonetic, word.Definition, word.UpdateDatetime.Format(time.RFC3339), 0)
	return err
}

func (d *Database) GetWord(id string) (*model.Word, error) {
	query := `
		SELECT id, english, chinese, phonetic, definition, update_datetime, is_deleted
		FROM words WHERE id = ?
	`
	row := d.conn.QueryRow(query, id)

	var word model.Word
	var updateTimeStr string
	var isDeletedInt int

	err := row.Scan(&word.ID, &word.English, &word.Chinese, &word.Phonetic, &word.Definition, &updateTimeStr, &isDeletedInt)
	if err != nil {
		return nil, err
	}

	word.UpdateDatetime, _ = time.Parse(time.RFC3339, updateTimeStr)
	word.IsDeleted = isDeletedInt == 1

	return &word, nil
}

func (d *Database) UpdateWord(word *model.Word) error {
	word.UpdateDatetime = time.Now().UTC()

	query := `
		UPDATE words 
		SET english = ?, chinese = ?, phonetic = ?, definition = ?, update_datetime = ?
		WHERE id = ?
	`
	_, err := d.conn.Exec(query, word.English, word.Chinese, word.Phonetic, word.Definition, word.UpdateDatetime.Format(time.RFC3339), word.ID)
	return err
}

func (d *Database) DeleteWord(id string) error {
	updateTime := time.Now().UTC().Format(time.RFC3339)
	query := `
		UPDATE words 
		SET is_deleted = 1, update_datetime = ?
		WHERE id = ?
	`
	_, err := d.conn.Exec(query, updateTime, id)
	return err
}

func (d *Database) SyncWords(since time.Time) ([]*model.Word, error) {
	query := `
		SELECT id, english, chinese, phonetic, definition, update_datetime, is_deleted
		FROM words 
		WHERE update_datetime > ?
		ORDER BY update_datetime ASC
	`
	rows, err := d.conn.Query(query, since.Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var words []*model.Word
	for rows.Next() {
		var word model.Word
		var updateTimeStr string
		var isDeletedInt int

		if err := rows.Scan(&word.ID, &word.English, &word.Chinese, &word.Phonetic, &word.Definition, &updateTimeStr, &isDeletedInt); err != nil {
			return nil, err
		}

		word.UpdateDatetime, _ = time.Parse(time.RFC3339, updateTimeStr)
		word.IsDeleted = isDeletedInt == 1
		words = append(words, &word)
	}

	return words, nil
}
