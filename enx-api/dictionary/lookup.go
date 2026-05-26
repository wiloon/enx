package dictionary

import (
	"errors"
	"net/http"

	"enx-api/ecdict"
	"enx-api/enx"
	"enx-api/repo"

	"github.com/gin-gonic/gin"
)

// ErrEcdictUnavailable is returned when local lookup misses and ECDICT is not configured.
var ErrEcdictUnavailable = errors.New("ecdict unavailable")

// FromRepoWord maps a repo Word to Dictionary when it has content.
func FromRepoWord(w *repo.Word) *enx.Dictionary {
	if w == nil || w.Id == "" || w.Chinese == "" {
		return nil
	}
	return &enx.Dictionary{
		English:       w.English,
		Chinese:       w.Chinese,
		Pronunciation: w.Pronunciation,
	}
}

// Lookup finds a definition: local words table (exact, then case-insensitive), then ECDICT (with word forms).
func Lookup(english string) (*enx.Dictionary, error) {
	if d := FromRepoWord(repo.GetWordByEnglish(english)); d != nil {
		return d, nil
	}
	if !ecdict.IsAvailable() {
		return nil, ErrEcdictUnavailable
	}
	return ecdict.Query(english), nil
}

// RespondUnavailable writes the ADR-mandated 503 JSON response.
func RespondUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"message": ecdict.UnavailableMessage(),
	})
}
