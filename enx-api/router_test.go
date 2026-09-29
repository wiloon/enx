package main

import (
	"strings"
	"testing"

	"enx-api/utils"

	"github.com/gin-gonic/gin"
)

// The browser extension and enx-ui call only the /api routes, so each
// endpoint is registered once, under /api. A second copy at the root was a
// leftover from before the /api prefix and doubled every route label.
func TestLookupRoutesAreRegisteredOnlyUnderAPI(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	registered := map[string]bool{}
	for _, r := range setupRouter().Routes() {
		registered[r.Method+" "+r.Path] = true
	}

	for _, route := range []string{
		"GET /paragraph-init",
		"GET /translate",
		"GET /word/:word",
		"POST /translate/sentence",
		"POST /translate/word-in-context",
		"POST /translate/sentence-with-word",
		"POST /rephrase",
		"GET /load-count",
		"POST /mark",
	} {
		if registered[route] {
			t.Errorf("%s is registered at the root; it should exist only under /api", route)
		}
		method, path, _ := strings.Cut(route, " ")
		if !registered[method+" /api"+path] {
			t.Errorf("%s /api%s is not registered", method, path)
		}
	}
}

// Routes with no remaining caller are gone: DELETE /api/word/:word moved to
// the admin group, and /api/wrap had no client at all.
func TestRemovedRoutesAreNotRegistered(t *testing.T) {
	utils.ViperInit()
	gin.SetMode(gin.TestMode)

	for _, r := range setupRouter().Routes() {
		switch r.Method + " " + r.Path {
		case "DELETE /api/word/:word", "GET /api/wrap":
			t.Errorf("%s %s is still registered", r.Method, r.Path)
		}
	}
}
