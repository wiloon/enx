package model

import "time"

type Word struct {
	ID             string    `json:"id"`
	English        string    `json:"english"`
	Chinese        string    `json:"chinese"`
	Phonetic       string    `json:"phonetic"`
	Definition     string    `json:"definition"`
	UpdateDatetime time.Time `json:"update_datetime"`
	IsDeleted      bool      `json:"is_deleted"`
}
