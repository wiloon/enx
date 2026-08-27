package middleware

import (
	"testing"

	"github.com/spf13/viper"
)

func TestCognitoConfigFromViper(t *testing.T) {
	viper.Set("cognito.region", "us-east-1")
	viper.Set("cognito.user-pool-id", "pool-123")
	viper.Set("cognito.client-id", "client-abc")
	viper.Set("cognito.chrome-client-id", "chrome-client-xyz")
	viper.Set("cognito.jwks-url", "https://example.com/jwks")
	defer func() {
		viper.Set("cognito.region", nil)
		viper.Set("cognito.user-pool-id", nil)
		viper.Set("cognito.client-id", nil)
		viper.Set("cognito.chrome-client-id", nil)
		viper.Set("cognito.jwks-url", nil)
	}()

	cfg := CognitoConfigFromViper()
	if cfg.Region != "us-east-1" {
		t.Errorf("Region = %q, want us-east-1", cfg.Region)
	}
	if cfg.UserPoolID != "pool-123" {
		t.Errorf("UserPoolID = %q, want pool-123", cfg.UserPoolID)
	}
	if len(cfg.ClientIDs) != 2 || cfg.ClientIDs[0] != "client-abc" || cfg.ClientIDs[1] != "chrome-client-xyz" {
		t.Errorf("ClientIDs = %v, want [client-abc chrome-client-xyz]", cfg.ClientIDs)
	}
	if cfg.JWKSURL != "https://example.com/jwks" {
		t.Errorf("JWKSURL = %q, want https://example.com/jwks", cfg.JWKSURL)
	}
}

func TestCognitoConfigFromViperOmitsEmptyClientIDs(t *testing.T) {
	viper.Set("cognito.client-id", "")
	viper.Set("cognito.chrome-client-id", "")
	defer func() {
		viper.Set("cognito.client-id", nil)
		viper.Set("cognito.chrome-client-id", nil)
	}()

	cfg := CognitoConfigFromViper()
	if len(cfg.ClientIDs) != 0 {
		t.Errorf("ClientIDs = %v, want empty", cfg.ClientIDs)
	}
}
