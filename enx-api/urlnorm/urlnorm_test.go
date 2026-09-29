package urlnorm

import (
	"errors"
	"strings"
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

// urlOfLength builds an https URL exactly n characters long.
func urlOfLength(n int) string {
	const prefix = "https://example.com/"
	return prefix + strings.Repeat("a", n-len(prefix))
}

func TestForSaveAcceptsAURLUpToTheLimitAndRejectsOneCharacterMore(t *testing.T) {
	if _, _, err := ForSave(urlOfLength(MaxURLLength)); err != nil {
		t.Fatalf("a URL of exactly %d characters: %v, want it accepted", MaxURLLength, err)
	}
	if _, _, err := ForSave(urlOfLength(MaxURLLength + 1)); !errors.Is(err, ErrURLTooLong) {
		t.Fatalf("a URL of %d characters: err=%v, want ErrURLTooLong", MaxURLLength+1, err)
	}
}

func TestForSaveToleratesLongTrackingSuffixesButNotAbsurdInput(t *testing.T) {
	// 3000 characters of campaign parameters on a short address: it is still a
	// short address once they are dropped.
	withTracking := "https://example.com/read?p=1&utm_campaign=" + strings.Repeat("x", 3000)
	got, _, err := ForSave(withTracking)
	if err != nil || got != "https://example.com/read?p=1" {
		t.Fatalf("long tracking suffix: got %q err=%v, want the short address", got, err)
	}

	// But input long enough to be abusive is refused before it is even parsed.
	if _, _, err := ForSave("https://example.com/?utm_campaign=" + strings.Repeat("x", 5000)); !errors.Is(err, ErrURLTooLong) {
		t.Fatalf("5000-character input: err=%v, want ErrURLTooLong", err)
	}
}
