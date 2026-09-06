package redisx

import "testing"

// TestGetRankByScoreZeroScoreShortCircuits covers the one branch of
// GetRankByScore that doesn't require a live redis connection: a score of 0
// returns rank 0 without ever calling Exec.
func TestGetRankByScoreZeroScoreShortCircuits(t *testing.T) {
	if got := GetRankByScore("some-key", 0); got != 0 {
		t.Errorf("GetRankByScore(key, 0) = %d, want 0", got)
	}
}

// ZADD swallows its Exec error, so it's safe to call even without a redis
// server reachable -- this just exercises the call path.
func TestZADDDoesNotPanicWithoutRedis(t *testing.T) {
	ZADD("some-key", 1, "member")
}
