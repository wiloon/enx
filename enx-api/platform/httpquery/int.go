// Package httpquery reads the query parameters shared by enx-api handlers.
package httpquery

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// Int reads an optional integer query parameter. An absent or empty value
// gives def; a value that is not a whole number gives ok false.
func Int(c *gin.Context, name string, def int) (n int, ok bool) {
	raw := c.Query(name)
	if raw == "" {
		return def, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return n, true
}
