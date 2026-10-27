package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBillingRoutesSelectCutoverReceiver(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	admin := api.Group("/admin")
	legacy := func(c *gin.Context) { c.Status(http.StatusTeapot) }
	assembly := &routeTestAssembly{}
	mountBillingRoutes(true, api, admin, router, legacy, legacy, assembly)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/billing/webhook", nil))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("webhook status = %d, want 202", rec.Code)
	}
	if assembly.mounts != 1 {
		t.Fatalf("mounts = %d, want 1", assembly.mounts)
	}
}

type routeTestAssembly struct{ mounts int }

func (a *routeTestAssembly) Mount(api, admin, root gin.IRoutes) {
	a.mounts++
	root.POST("/billing/webhook", func(c *gin.Context) { c.Status(http.StatusAccepted) })
	api.POST("/billing/portal", func(c *gin.Context) { c.Status(http.StatusAccepted) })
}

func TestBillingRoutesSelectLegacyHandlersWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	assembly := &routeTestAssembly{}
	portal := func(c *gin.Context) { c.Status(http.StatusCreated) }
	webhook := func(c *gin.Context) { c.Status(http.StatusTeapot) }
	mountBillingRoutes(false, api, api.Group("/admin"), router, portal, webhook, assembly)
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/billing/webhook", http.StatusTeapot},
		{"/api/billing/portal", http.StatusCreated},
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, tc.path, nil))
		if rec.Code != tc.want {
			t.Errorf("%s status = %d, want %d", tc.path, rec.Code, tc.want)
		}
	}
	if assembly.mounts != 0 {
		t.Fatalf("assembly mounted %d times", assembly.mounts)
	}
}
