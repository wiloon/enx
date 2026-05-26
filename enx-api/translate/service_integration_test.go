//go:build integration

package translate

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/ecdict"
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func TestMain(m *testing.M) {
	logger.Init("CONSOLE", "debug", "enx-api-test")
	utils.ViperInit()
	sqlitex.Init()
	ecdict.Init(viper.GetString("ecdict.db_path"))
	m.Run()
}

func TestTranslateReturns503WhenEcdictRequiredButMissing(t *testing.T) {
	ecdict.Init("")
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(func(ctx *gin.Context) {
		ctx.Set("user_id", "test-user")
		ctx.Next()
	})
	r.GET("/translate", Translate)

	req := httptest.NewRequest(http.MethodGet, "/translate?word=notlocalxyz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d body=%s", w.Code, w.Body.String())
	}
}
