package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/ecdict"

	"github.com/gin-gonic/gin"
)

func callWithWord(h gin.HandlerFunc, word string) int {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Params = gin.Params{{Key: "word", Value: word}}
	h(c)
	return w.Code
}

// The routes' happy paths run end to end in package main
// (admin_dictionary_test.go); these pin the input and availability guards.
func TestAdminHandlersRejectBlankWord(t *testing.T) {
	for name, h := range map[string]gin.HandlerFunc{
		"AdminGetWord":            AdminGetWord,
		"AdminGetEcdict":          AdminGetEcdict,
		"AdminSyncWordFromEcdict": AdminSyncWordFromEcdict,
		"AdminDeleteWord":         AdminDeleteWord,
	} {
		if code := callWithWord(h, "  "); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, code)
		}
	}
}

func TestAdminEcdictHandlersNeedEcdict(t *testing.T) {
	ecdict.Init("")
	for name, h := range map[string]gin.HandlerFunc{
		"AdminGetEcdict":          AdminGetEcdict,
		"AdminSyncWordFromEcdict": AdminSyncWordFromEcdict,
	} {
		if code := callWithWord(h, "hello"); code != http.StatusServiceUnavailable {
			t.Errorf("%s: status %d, want 503", name, code)
		}
	}
}
