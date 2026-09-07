package aicfg

import (
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestRequestTimeout(t *testing.T) {
	t.Cleanup(func() { viper.Set("sentence-translate.request-timeout", nil) })

	tests := []struct {
		name string
		set  any
		want time.Duration
	}{
		{"unset falls back to default", nil, defaultRequestTimeout},
		{"zero falls back to default", "0s", defaultRequestTimeout},
		{"negative falls back to default", "-5s", defaultRequestTimeout},
		{"honors configured duration", "90s", 90 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			viper.Set("sentence-translate.request-timeout", tt.set)
			if got := RequestTimeout(); got != tt.want {
				t.Errorf("RequestTimeout() = %v, want %v", got, tt.want)
			}
		})
	}
}
