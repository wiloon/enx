package urlnorm

import (
	"errors"
	"testing"
)

func TestForSaveDropsFragmentAndCredentialsAndLowercasesTheHost(t *testing.T) {
	got, host, err := ForSave("https://user:secret@WWW.InfoQ.com/Articles/Kube?id=42#section-3")
	if err != nil {
		t.Fatalf("ForSave: %v", err)
	}
	// The path keeps its case and the query stays: both are needed to reopen the page.
	if want := "https://www.infoq.com/Articles/Kube?id=42"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if host != "www.infoq.com" {
		t.Fatalf("host: got %q, want www.infoq.com", host)
	}
}

func TestForSaveDropsTrackingParametersButKeepsTheRestInOrder(t *testing.T) {
	got, _, err := ForSave("https://example.com/read?p=456&utm_source=twitter&fbclid=abc&page=2&gclid=x&utm_medium=social&mc_cid=1&mc_eid=2")
	if err != nil {
		t.Fatalf("ForSave: %v", err)
	}
	if want := "https://example.com/read?p=456&page=2"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestForSaveLeavesNoTrailingQuestionMarkWhenEveryParameterIsTracking(t *testing.T) {
	got, _, _ := ForSave("https://example.com/a?utm_source=x&fbclid=y")
	if want := "https://example.com/a"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestForSaveDropsXShareParametersOnlyOnX(t *testing.T) {
	for _, host := range []string{"x.com", "www.x.com", "twitter.com", "mobile.twitter.com"} {
		got, _, _ := ForSave("https://" + host + "/sairahul1/status/2089995692874068433?s=20&t=abc123")
		if want := "https://" + host + "/sairahul1/status/2089995692874068433"; got != want {
			t.Errorf("%s: got %q, want %q", host, got, want)
		}
	}
	// Elsewhere s and t are real parameters: t=90 is a video timestamp.
	got, _, _ := ForSave("https://www.youtube.com/watch?v=abc&t=90&s=1")
	if want := "https://www.youtube.com/watch?v=abc&t=90&s=1"; got != want {
		t.Errorf("non-X host lost parameters: got %q, want %q", got, want)
	}
	// A lookalike host is not X.
	got, _, _ = ForSave("https://notx.com/a?s=1&t=2")
	if want := "https://notx.com/a?s=1&t=2"; got != want {
		t.Errorf("lookalike host treated as X: got %q, want %q", got, want)
	}
}

func TestForSaveRejectsAnythingThatIsNotAWebPage(t *testing.T) {
	for _, raw := range []string{
		"", "not a url", "example.com/no-scheme",
		"ftp://example.com/a", "javascript:alert(1)", "chrome://extensions",
		"file:///etc/passwd", "data:text/html,hi", "https:///no-host",
	} {
		if _, _, err := ForSave(raw); !errors.Is(err, ErrInvalidURL) {
			t.Errorf("ForSave(%q): err=%v, want ErrInvalidURL", raw, err)
		}
	}
}
