package ailimit

import (
	"fmt"
	"time"
)

// DayLimitMessage is the user-facing 429 text for a trial user over the
// daily call limit at time at. The limiter's day is the UTC day, which ends
// at a different local hour for every user, so the text names the hours left
// until the reset (rounded up) rather than saying "tomorrow".
func DayLimitMessage(at time.Time) string {
	at = at.UTC()
	midnight := time.Date(at.Year(), at.Month(), at.Day()+1, 0, 0, 0, 0, time.UTC)
	hours := int((midnight.Sub(at) + time.Hour - 1) / time.Hour)
	unit := "hours"
	if hours == 1 {
		unit = "hour"
	}
	return fmt.Sprintf("You've reached today's trial limit. Try again in %d %s, or subscribe for more.", hours, unit)
}
