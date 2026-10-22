package billing

import "enx-api/utils/sqlitex"

// billableStatuses are the Stripe subscription statuses in which Stripe can
// still charge the subscription. enx-ui/src/lib/plans.ts keeps the same list
// to disable its Subscribe buttons.
var billableStatuses = map[string]bool{
	"active":     true,
	"trialing":   true,
	"past_due":   true,
	"incomplete": true,
	"unpaid":     true,
}

// hasLiveSubscription reports whether sub is a subscription Stripe can still
// bill. The subscriptions table tracks one subscription per user, so a user
// with a live one must change plans or fix payment in the Customer Portal
// rather than start a second checkout.
func hasLiveSubscription(sub sqlitex.Subscription) bool {
	return sub.StripeSubscriptionId != nil && billableStatuses[sub.Status]
}
