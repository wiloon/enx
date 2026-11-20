package config

import (
	"reflect"
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
	const (
		legacyVar  = "ADMIN_CLERK_USER_IDS"
		legacyTOML = "admin.clerk-user-ids"
	)
	cases := []struct {
		name   string
		vars   map[string]string
		toml   string
		want   []string
		source string
	}{
		{"new only", map[string]string{"ADMIN_AUTH_SUBJECTS": "a b"}, "", []string{"a", "b"}, ""},
		{"old only", map[string]string{"ADMIN_CLERK_USER_IDS": "c d"}, "", []string{"c", "d"}, legacyVar},
		{"both, new wins", map[string]string{"ADMIN_AUTH_SUBJECTS": "a", "ADMIN_CLERK_USER_IDS": "c"}, "", []string{"a"}, ""},
		{"blank new, populated old", map[string]string{"ADMIN_AUTH_SUBJECTS": "  ", "ADMIN_CLERK_USER_IDS": "c"}, "", []string{"c"}, legacyVar},
		{"empty new, populated old", map[string]string{"ADMIN_AUTH_SUBJECTS": "", "ADMIN_CLERK_USER_IDS": "c"}, "", []string{"c"}, legacyVar},
		{"var overrides same-name toml", map[string]string{"ADMIN_AUTH_SUBJECTS": "a"}, "[admin]\nauth-subjects = [\"t\"]\n", []string{"a"}, ""},
		{"legacy var overrides same-name legacy toml", map[string]string{"ADMIN_CLERK_USER_IDS": "c"}, "[admin]\nclerk-user-ids = [\"t\"]\n", []string{"c"}, legacyVar},
		{"legacy var beats new toml", map[string]string{"ADMIN_CLERK_USER_IDS": "c"}, "[admin]\nauth-subjects = [\"t\"]\n", []string{"c"}, legacyVar},
		{"blank new var falls to new toml", map[string]string{"ADMIN_AUTH_SUBJECTS": " "}, "[admin]\nauth-subjects = [\"t\"]\nclerk-user-ids = [\"u\"]\n", []string{"t"}, ""},
		{"both toml keys, new wins", nil, "[admin]\nauth-subjects = [\"t\"]\nclerk-user-ids = [\"u\"]\n", []string{"t"}, ""},
		{"legacy toml fallback", nil, "[admin]\nauth-subjects = []\nclerk-user-ids = [\"u\"]\n", []string{"u"}, legacyTOML},
		{"legacy toml only", nil, "[admin]\nclerk-user-ids = [\"u\"]\n", []string{"u"}, legacyTOML},
		{"unused legacy input", map[string]string{"ADMIN_AUTH_SUBJECTS": "a"}, "[admin]\nclerk-user-ids = [\"u\"]\n", []string{"a"}, ""},
		{"nothing set", nil, "", nil, ""},
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
			if got.DeprecatedSource != tc.source {
				t.Errorf("DeprecatedSource = %q, want %q", got.DeprecatedSource, tc.source)
			}
		})
	}
}
