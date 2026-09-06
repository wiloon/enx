package handlers

import (
	"encoding/json"
	"enx-api/version"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupVersionRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/version", GetVersion)
	r.GET("/version/simple", GetVersionSimple)
	return r
}

func TestGetVersion(t *testing.T) {
	r := setupVersionRouter()

	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp VersionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if !resp.Success {
		t.Error("expected success=true")
	}
	if resp.Data == nil {
		t.Fatal("expected data to be populated")
	}
	if resp.Data.Version != version.Version {
		t.Errorf("expected version %q, got %q", version.Version, resp.Data.Version)
	}
	if resp.Data.GitCommit != version.GitCommit {
		t.Errorf("expected git commit %q, got %q", version.GitCommit, resp.Data.GitCommit)
	}
	if resp.Data.Uptime == "" {
		t.Error("expected uptime to be populated")
	}
	if resp.Message == "" {
		t.Error("expected a non-empty message")
	}
}

func TestGetVersionSimple(t *testing.T) {
	r := setupVersionRouter()

	req := httptest.NewRequest(http.MethodGet, "/version/simple", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if body["version"] != version.Version {
		t.Errorf("expected version %q, got %q", version.Version, body["version"])
	}
	if body["commit"] != version.GitCommit {
		t.Errorf("expected commit %q, got %q", version.GitCommit, body["commit"])
	}
	if body["build_time"] != version.BuildTime {
		t.Errorf("expected build_time %q, got %q", version.BuildTime, body["build_time"])
	}
}
