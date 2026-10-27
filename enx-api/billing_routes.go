package main

import "github.com/gin-gonic/gin"

type billingRouteAssembly interface {
	Mount(api, admin, root gin.IRoutes)
}

// mountBillingRoutes selects one owner for the shared billing routes.
func mountBillingRoutes(cutover bool, api, admin, root gin.IRoutes, legacyPortal, legacyWebhook gin.HandlerFunc, assembly billingRouteAssembly) {
	if cutover {
		assembly.Mount(api, admin, root)
		return
	}
	api.POST("/billing/portal", legacyPortal)
	root.POST("/billing/webhook", legacyWebhook)
}
