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

type UserDict struct {
	WordId            int
	QueryCount        int
	UpdateTime        time.Time
	UserId            int
	AlreadyAcquainted int
}
