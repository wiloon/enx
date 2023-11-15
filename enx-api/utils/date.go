package utils

import (
	"time"
)

func TimeNowMicrosecond() int64 {
	return TimeToMicroSecond(time.Now())
}

func TimeToMicroSecond(t time.Time) int64 {
	return t.UnixNano() / int64(time.Microsecond)
}
