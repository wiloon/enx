package credit

import "testing"

func TestTokenPricingPriced(t *testing.T) {
	cases := []struct {
		name    string
		pricing TokenPricing
		want    bool
	}{
		{"fully configured", TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}, true},
		{"only output weight", TokenPricing{WeightIn: 0, WeightOut: 3, Divisor: 3000}, true},
		{"zero divisor", TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 0}, false},
		{"negative divisor", TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: -1}, false},
		{"both weights zero", TokenPricing{WeightIn: 0, WeightOut: 0, Divisor: 3000}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.pricing.Priced(); got != c.want {
				t.Fatalf("Priced() = %v, want %v", got, c.want)
			}
		})
	}
}

func TestTokenPricingCost(t *testing.T) {
	p := TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}
	cases := []struct {
		name             string
		prompt, complete int
		want             int64
	}{
		{"typical call rounds up", 600, 900, 2}, // ceil(3300/3000)
		{"exact multiple", 3000, 0, 1},          // 3000/3000
		{"just over a multiple", 3001, 0, 2},    // ceil(3001/3000)
		{"tiny usage floors at 1", 1, 1, 1},     // ceil(4/3000) -> 1
		{"zero usage floors at 1", 0, 0, 1},     // never free
		{"output weighted heavier", 0, 1000, 1}, // ceil(3000/3000)
		{"output weighted heavier +1", 0, 1001, 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := p.Cost(c.prompt, c.complete); got != c.want {
				t.Fatalf("Cost(%d, %d) = %d, want %d", c.prompt, c.complete, got, c.want)
			}
		})
	}
}
