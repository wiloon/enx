package dictionary

import (
	"context"
	"errors"
	"net/http"

	"enx-api/ecdict"
	"enx-api/enx"

	"github.com/gin-gonic/gin"
)

// ErrEcdictUnavailable is returned when ECDICT is not configured.
var ErrEcdictUnavailable = errors.New("ecdict unavailable")

// Lookup queries ECDICT (with word forms). Callers are expected to have
// already checked the local words table themselves before calling this.
func Lookup(ctx context.Context, english string) (*enx.Dictionary, error) {
	if !ecdict.IsAvailable() {
		return nil, ErrEcdictUnavailable
	}
	return ecdict.Query(ctx, english), nil
}

// RespondUnavailable writes the ADR-mandated 503 JSON response.
func RespondUnavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"success": false,
		"message": ecdict.UnavailableMessage(),
	})
}
