package server

import (
	"net/http"
	"testing"

	"enx-api/platform/clerktest"
	"enx-api/utils/sqlitex/sqlitextest"

	"github.com/golang-jwt/jwt/v5"
)

// Wiring: a versioned save through the production router reaches the
// database. The save rules are in reader and reader/saving.
func TestE2E_ReaderVersionedSaveStoresTheContent(t *testing.T) {
	jwks := clerktest.NewEnv(t)
	cfg := noTrialConfig()
	cfg.Clerk = jwks.Config()
	db := sqlitextest.Open(t)
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": "user_e2ereadersave", "email": "reader@example.com"})
	ts, done := e2eServer(t, db, cfg)
	defer done()

	// A client-chosen UUID at version 1 creates the document; version 2 edits it.
	url := ts.URL + "/api/reader/documents/9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	for version, content := range []string{"original", "revised"} {
		code, saved := doJSONBody(t, http.MethodPut, url, token, map[string]any{"content": content, "version": version + 1})
		if code != http.StatusOK || saved["success"] != true {
			t.Fatalf("save %q: %d %v", content, code, saved)
		}
	}
	if code, stored := doJSON(t, http.MethodGet, url, token); code != http.StatusOK || stored["content"] != "revised" {
		t.Fatalf("stored: %d %v, want content revised", code, stored)
	}
}
