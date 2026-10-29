package main

import (
	"time"

	"enx-api/adminuser"
	"enx-api/dictionary"
	"enx-api/entitlement"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/repo"
)

type billingReaders struct {
	subscriptions dictionary.Subscriptions
	entitlements  *entitlement.Service
	admin         adminuser.Store
}

func newBillingReaders(cutover bool) billingReaders {
	var subscriptions dictionary.Subscriptions = entadapters.Billing{}
	legacy := repo.AdminUsers{Now: time.Now}
	var admin adminuser.Store = legacy
	if cutover {
		subscriptions = repo.AcceptedSubscriptions{}
		admin = repo.AcceptedAdminUsers{AdminUsers: legacy}
	}
	return billingReaders{subscriptions: subscriptions, entitlements: entitlement.NewService(entadapters.Billing{Subscriptions: subscriptions}), admin: admin}
}
