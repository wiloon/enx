package server

import (
	"time"

	"enx-api/adminuser"
	"enx-api/dictionary"
	"enx-api/entitlement"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/repo"
)

type billingReaders struct {
	quotaTiers   dictionary.QuotaTierSource
	entitlements *entitlement.Service
	admin        adminuser.Store
}

func newBillingReaders() billingReaders {
	// One source for the quota tier and the entitlement, so both keep the
	// accepted-subscription rule (ADR-067).
	billing := entadapters.Billing{Subscriptions: repo.AcceptedSubscriptions{}}
	admin := repo.AcceptedAdminUsers{AdminUsers: repo.AdminUsers{Now: time.Now}}
	return billingReaders{quotaTiers: billing, entitlements: entitlement.NewService(billing), admin: admin}
}
