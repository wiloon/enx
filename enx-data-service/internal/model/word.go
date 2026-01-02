package model

// Word represents a vocabulary word in the ENX system
// Aligned with migrated database schema (UUID + Unix timestamps)
type Word struct {
	ID            string  `json:"id"`            // UUID v4 primary key
	English       string  `json:"english"`       // English word (unique)
	Chinese       *string `json:"chinese"`       // Chinese translation (nullable)
	Pronunciation *string `json:"pronunciation"` // Pronunciation guide (nullable)
	CreatedAt     int64   `json:"created_at"`    // Unix timestamp in milliseconds
	LoadCount     int     `json:"load_count"`    // Usage counter
	UpdatedAt     int64   `json:"updated_at"`    // Unix timestamp in milliseconds (required for sync)
	DeletedAt     *int64  `json:"deleted_at"`    // Soft delete timestamp (NULL = not deleted)
}

// UserDict represents user-specific word data (query count, familiarity)
type UserDict struct {
	UserId            string `json:"user_id"`            // User UUID
	WordId            string `json:"word_id"`            // Word UUID (foreign key to words.id)
	QueryCount        int    `json:"query_count"`        // Number of times user queried this word
	AlreadyAcquainted int    `json:"already_acquainted"` // 0 = learning, 1 = already knows
	CreatedAt         int64  `json:"created_at"`         // Unix timestamp in milliseconds
	UpdatedAt         int64  `json:"updated_at"`         // Unix timestamp in milliseconds
}
