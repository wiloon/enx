package config

import (
	"reflect"
	"strings"
	"testing"
)

func adminFrom(t *testing.T, toml string) Admin {
	t.Helper()
	path := ""
	if toml != "" {
		path = writeTOML(t, toml)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return cfg.Admin
}

func TestAdminListSelection(t *testing.T) {
	cases := []struct {
		name string
		vars map[string]string
		toml string
		want []string
	}{
		{"env only", map[string]string{"ADMIN_AUTH_SUBJECTS": "a b"}, "", []string{"a", "b"}},
		{"env overrides toml", map[string]string{"ADMIN_AUTH_SUBJECTS": "a"}, "[admin]\nauth-subjects = [\"t\"]\n", []string{"a"}},
		{"blank env falls to toml", map[string]string{"ADMIN_AUTH_SUBJECTS": " "}, "[admin]\nauth-subjects = [\"t\"]\n", []string{"t"}},
		{"toml only", nil, "[admin]\nauth-subjects = [\"t\", \" \"]\n", []string{"t"}},
		{"nothing set", nil, "", nil},
		// The deprecated name (ADR-036, #1027) is no longer read.
		{"removed env name is ignored", map[string]string{"ADMIN_CLERK_USER_IDS": "c d"}, "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolate(t)
			for k, v := range tc.vars {
				t.Setenv(k, v)
			}
			got := adminFrom(t, tc.toml)
			if !reflect.DeepEqual(got.AuthSubjects, tc.want) {
				t.Errorf("AuthSubjects = %q, want %q", got.AuthSubjects, tc.want)
			}
		})
	}
}

// A config file still carrying the removed admin.clerk-user-ids key fails to
// load instead of silently turning the admin endpoints off.
func TestAdminRemovedTOMLKeyIsRejected(t *testing.T) {
	isolate(t)
	_, err := Load(writeTOML(t, "[admin]\nclerk-user-ids = [\"u\"]\n"))
	if err == nil || !strings.Contains(err.Error(), "clerk-user-ids") {
		t.Fatalf("Load error = %v, want one naming clerk-user-ids", err)
	}
}
