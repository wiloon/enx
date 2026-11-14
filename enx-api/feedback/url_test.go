package feedback

import (
	"errors"
	"strings"
	"testing"
)

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
		{"keeps a short CJK segment", "https://example.com/中文字符测试示例一二三四",
			"https://example.com/%E4%B8%AD%E6%96%87%E5%AD%97%E7%AC%A6%E6%B5%8B%E8%AF%95%E7%A4%BA%E4%BE%8B%E4%B8%80%E4%BA%8C%E4%B8%89%E5%9B%9B", "example.com"},
		{"redacts a long CJK segment", "https://example.com/" + strings.Repeat("中", 32), "https://example.com/:redacted", "example.com"},
		{"keeps a segment whose only digits are superscript", "https://example.com/" + strings.Repeat("a", 19) + "²",
			"https://example.com/aaaaaaaaaaaaaaaaaaa%C2%B2", "example.com"},
		{"keeps a segment whose only digits are a Roman numeral", "https://example.com/" + strings.Repeat("a", 19) + "Ⅻ",
			"https://example.com/aaaaaaaaaaaaaaaaaaa%E2%85%AB", "example.com"},
		{"drops the default https port", "https://x.com:443/a", "https://x.com/a", "x.com"},
		{"drops the default http port", "http://x.com:80/a", "http://x.com/a", "x.com"},
		{"keeps a non-default port", "https://x.com:8443/a", "https://x.com:8443/a", "x.com"},
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
		"https://example.com/a?" + strings.Repeat("q", 4097),
	} {
		if _, _, err := SanitizeURL(in); !errors.Is(err, ErrInvalidURL) {
			t.Errorf("SanitizeURL(%q): got %v, want ErrInvalidURL", in, err)
		}
	}
}
