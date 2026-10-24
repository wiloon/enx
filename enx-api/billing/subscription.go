package billing

import (
	"enx-api/billing/acceptance"
	"enx-api/utils/sqlitex"
)

// hasLiveSubscription reports whether sub is a subscription Stripe can still
// bill (acceptance.Billable; enx-ui/src/lib/plans.ts keeps the same list to
// disable its Subscribe buttons). The subscriptions table tracks one
// subscription per user, so a user with a live one must change plans or fix
// payment in the Customer Portal rather than start a second checkout.
func hasLiveSubscription(sub sqlitex.Subscription) bool {
	return sub.StripeSubscriptionId != nil && acceptance.Billable(sub.Status)
}

// portalRestricted reports whether a Portal session must use the restricted
// configuration, given the subscription's live Stripe status ("" for none):
// billable but not healthy, and only active is healthy (ADR-067).
func portalRestricted(liveStatus string) bool {
	return acceptance.Billable(liveStatus) && liveStatus != "active"
}
