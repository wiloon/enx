package eligibility

const periodEnd = 2000

func live(status string) *Live {
	return &Live{Status: status, CurrentPeriodEnd: periodEnd}
}

func accepted(tier, status string) *Accepted {
	return &Accepted{Tier: tier, Live: Live{Status: status, CurrentPeriodEnd: periodEnd}}
}
