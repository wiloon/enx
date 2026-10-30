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

func newBillingReaders() billingReaders {
	var subscriptions dictionary.Subscriptions = repo.AcceptedSubscriptions{}
	admin := repo.AcceptedAdminUsers{AdminUsers: repo.AdminUsers{Now: time.Now}}
	return billingReaders{subscriptions: subscriptions, entitlements: entitlement.NewService(entadapters.Billing{Subscriptions: subscriptions}), admin: admin}
}
