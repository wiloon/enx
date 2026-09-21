package pagereport

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-pagereport-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

func TestSanitizeURL(t *testing.T) {
	cases := []struct {
		name, in, wantURL, wantHost string
	}{
		{"strips query and fragment", "https://x.com/sairahul1/status/2089995692874068433?s=20&t=abc#frag",
			"https://x.com/sairahul1/status/2089995692874068433", "x.com"},
		{"strips credentials", "https://user:pass@www.infoq.com/articles/x", "https://www.infoq.com/articles/x", "www.infoq.com"},
		{"lowercases host", "https://WWW.InfoQ.com/Articles/X", "https://www.infoq.com/Articles/X", "www.infoq.com"},
		{"keeps a 19-digit tweet id", "https://x.com/a/status/2089995692874068433", "https://x.com/a/status/2089995692874068433", "x.com"},
		{"redacts an email path segment", "https://messaging-custom-newsletters.nytimes.com/unsub/jane@example.com/go",
			"https://messaging-custom-newsletters.nytimes.com/unsub/:redacted/go", "messaging-custom-newsletters.nytimes.com"},
		{"redacts a long mixed token", "https://example.com/r/AbC123dEf456GhI789jKl012/page",
			"https://example.com/r/:redacted/page", "example.com"},
		{"redacts a very long segment", "https://example.com/" + strings.Repeat("a", 40), "https://example.com/:redacted", "example.com"},
		{"keeps a normal slug", "https://www.infoq.com/articles/kubernetes-operators-in-practice", "https://www.infoq.com/articles/kubernetes-operators-in-practice", "www.infoq.com"},
		{"bare origin", "https://x.com", "https://x.com/", "x.com"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, host, err := SanitizeURL(c.in)
			if err != nil {
				t.Fatalf("SanitizeURL(%q): %v", c.in, err)
			}
			if got != c.wantURL || host != c.wantHost {
				t.Fatalf("got (%q, %q), want (%q, %q)", got, host, c.wantURL, c.wantHost)
			}
		})
	}
}

func TestSanitizeURLRejects(t *testing.T) {
	for _, in := range []string{
		"", "not a url", "ftp://example.com/a", "javascript:alert(1)", "chrome://extensions",
		"file:///etc/passwd", "https:///nohost", "https://example.com/" + strings.Repeat("a/", 600),
	} {
		if _, _, err := SanitizeURL(in); !errors.Is(err, ErrInvalidURL) {
			t.Errorf("SanitizeURL(%q): got %v, want ErrInvalidURL", in, err)
		}
	}
}

func input(url string) Input {
	return Input{URL: url, Reason: "no-article-node", Adapter: "x", ExtVersion: "1.0.1"}
}

func TestSubmitStoresSanitizedReport(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()

	recorded, err := Submit(ctx, user, input("https://x.com/a/status/1?s=20#x"), time.Now())
	if err != nil || !recorded {
		t.Fatalf("Submit: recorded=%v err=%v", recorded, err)
	}

	var row sqlitex.PageReport
	if err := sqlitex.DB.Where("user_id = ?", user).First(&row).Error; err != nil {
		t.Fatalf("load row: %v", err)
	}
	if row.URL != "https://x.com/a/status/1" || row.Host != "x.com" || row.Reason != "no-article-node" || row.Adapter != "x" {
		t.Fatalf("unexpected row: %+v", row)
	}
}

func TestSubmitRejectsBadInput(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	now := time.Now()

	if _, err := Submit(ctx, "", input("https://x.com/a"), now); err == nil {
		t.Error("missing user id: want error")
	}
	if _, err := Submit(ctx, user, Input{URL: "https://x.com/a", Reason: "lookup-failed"}, now); !errors.Is(err, ErrInvalidReason) {
		t.Errorf("unreportable reason: got %v, want ErrInvalidReason", err)
	}
	if _, err := Submit(ctx, user, input("ftp://x.com/a"), now); !errors.Is(err, ErrInvalidURL) {
		t.Errorf("bad url: got %v, want ErrInvalidURL", err)
	}
	bad := input("https://x.com/a")
	bad.Adapter = "Bad Adapter!"
	if _, err := Submit(ctx, user, bad, now); !errors.Is(err, ErrInvalidField) {
		t.Errorf("bad adapter: got %v, want ErrInvalidField", err)
	}
}

func TestSubmitDedupesSamePageWithinADay(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	now := time.Now()

	if r, err := Submit(ctx, user, input("https://x.com/a/status/1"), now); err != nil || !r {
		t.Fatalf("first: recorded=%v err=%v", r, err)
	}
	// Same page, differing only in the parts sanitizing strips -> same report.
	if r, err := Submit(ctx, user, input("https://x.com/a/status/1?s=99"), now.Add(time.Hour)); err != nil || r {
		t.Fatalf("repeat: recorded=%v err=%v, want recorded=false", r, err)
	}
	if r, err := Submit(ctx, user, input("https://x.com/a/status/1"), now.Add(25*time.Hour)); err != nil || !r {
		t.Fatalf("next day: recorded=%v err=%v, want recorded=true", r, err)
	}
	var n int64
	sqlitex.DB.Model(&sqlitex.PageReport{}).Where("user_id = ?", user).Count(&n)
	if n != 2 {
		t.Fatalf("rows: got %d want 2", n)
	}
}

func TestSubmitEvictsOldestAtPerUserCap(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	now := time.Now()

	for i := 0; i < MaxReportsPerUser+3; i++ {
		url := fmt.Sprintf("https://x.com/a/article-%d", i)
		if _, err := Submit(ctx, user, input(url), now.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatalf("Submit %d: %v", i, err)
		}
	}
	var n int64
	sqlitex.DB.Model(&sqlitex.PageReport{}).Where("user_id = ?", user).Count(&n)
	if n != MaxReportsPerUser {
		t.Fatalf("rows: got %d want %d", n, MaxReportsPerUser)
	}
	var oldest sqlitex.PageReport
	sqlitex.DB.Where("user_id = ?", user).Order("created_at ASC").First(&oldest)
	if oldest.URL != "https://x.com/a/article-3" {
		t.Fatalf("oldest kept: %q (the 3 earliest should have been evicted)", oldest.URL)
	}
}

func TestPurgeExpiredRemovesOnlyOldRows(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	now := time.Now()

	Submit(ctx, user, input("https://x.com/a/status/1"), now.Add(-retention-time.Hour))
	Submit(ctx, user, input("https://x.com/a/status/2"), now)

	deleted, err := PurgeExpired(ctx, now)
	if err != nil || deleted < 1 {
		t.Fatalf("PurgeExpired: deleted=%d err=%v", deleted, err)
	}
	var rows []sqlitex.PageReport
	sqlitex.DB.Where("user_id = ?", user).Find(&rows)
	if len(rows) != 1 || rows[0].URL != "https://x.com/a/status/2" {
		t.Fatalf("remaining rows: %+v", rows)
	}
}
