package storage

import "time"

type Word struct {
	Id             int
	English        string
	LoadCount      int
	Chinese        string
	Pronunciation  string
	CreateDatetime time.Time
	UpdateDatetime time.Time
}
