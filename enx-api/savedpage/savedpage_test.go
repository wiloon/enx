package savedpage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"enx-api/urlnorm"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-savedpage-test.db")
	os.Remove(dbPath)
	sqlitex.Init(dbPath)
	os.Exit(m.Run())
}

func TestSavedPageAppearsInTheUsersList(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()

	_, created, err := Save(ctx, user, Input{
		URL:   "https://www.infoq.com/articles/kubernetes-operators",
		Title: "Kubernetes operators in practice",
	}, time.Now())
	if err != nil || !created {
		t.Fatalf("Save: created=%v err=%v", created, err)
	}

	pages, err := List(ctx, user)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(pages) != 1 {
		t.Fatalf("List: got %d pages, want 1", len(pages))
	}
	if pages[0].URL != "https://www.infoq.com/articles/kubernetes-operators" ||
		pages[0].Title != "Kubernetes operators in practice" ||
		pages[0].Host != "www.infoq.com" {
		t.Fatalf("unexpected page: %+v", pages[0])
	}
}

func TestSavingTheSamePageAgainReturnsTheExistingOne(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	in := Input{URL: "https://www.infoq.com/articles/kubernetes-operators", Title: "Kubernetes operators"}

	first, created, err := Save(ctx, user, in, time.Now())
	if err != nil || !created {
		t.Fatalf("first Save: created=%v err=%v", created, err)
	}
	second, created, err := Save(ctx, user, in, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("second Save: %v", err)
	}
	if created {
		t.Error("second Save: created=true, want false for an already-saved page")
	}
	if second.ID != first.ID {
		t.Errorf("second Save returned a different page: %q vs %q", second.ID, first.ID)
	}

	pages, _ := List(ctx, user)
	if len(pages) != 1 {
		t.Fatalf("List: got %d pages, want 1", len(pages))
	}
}

func TestUsersOnlySeeTheirOwnSavedPages(t *testing.T) {
	ctx := context.Background()
	alice, bob := "u-alice-"+t.Name(), "u-bob-"+t.Name()
	in := Input{URL: "https://www.infoq.com/articles/shared-link", Title: "Same link"}

	if _, created, err := Save(ctx, alice, in, time.Now()); err != nil || !created {
		t.Fatalf("alice Save: created=%v err=%v", created, err)
	}
	// The same URL saved by another user is that user's own page, not a duplicate.
	if _, created, err := Save(ctx, bob, in, time.Now()); err != nil || !created {
		t.Fatalf("bob Save: created=%v err=%v, want a new page of his own", created, err)
	}

	for _, user := range []string{alice, bob} {
		pages, err := List(ctx, user)
		if err != nil || len(pages) != 1 {
			t.Fatalf("List(%s): got %d pages err=%v, want exactly 1", user, len(pages), err)
		}
	}
	carol, _ := List(ctx, "u-carol-"+t.Name())
	if len(carol) != 0 {
		t.Fatalf("a user who saved nothing sees %d pages", len(carol))
	}
}

func TestTitleIsTruncatedToTwoHundredCharacters(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	// 300 Chinese characters: the limit counts characters, not bytes.
	long := strings.Repeat("读", 300)

	page, _, err := Save(ctx, user, Input{URL: "https://example.com/a", Title: long}, time.Now())
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if got := utf8.RuneCountInString(page.Title); got != 200 {
		t.Fatalf("saved title has %d characters, want 200", got)
	}
	pages, _ := List(ctx, user)
	if got := utf8.RuneCountInString(pages[0].Title); got != 200 {
		t.Fatalf("listed title has %d characters, want 200", got)
	}
}

// fillToLimit saves MaxPerUser distinct pages for user and returns the URL of the first.
func fillToLimit(t *testing.T, user string) string {
	t.Helper()
	ctx := context.Background()
	now := time.Now()
	for i := 0; i < MaxPerUser; i++ {
		in := Input{URL: fmt.Sprintf("https://example.com/articles/%d", i), Title: "t"}
		if _, created, err := Save(ctx, user, in, now.Add(time.Duration(i)*time.Millisecond)); err != nil || !created {
			t.Fatalf("Save %d: created=%v err=%v", i, created, err)
		}
	}
	return "https://example.com/articles/0"
}

func TestSavingBeyondTheLimitIsRejectedAndNothingIsEvicted(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	oldest := fillToLimit(t, user)

	_, created, err := Save(ctx, user, Input{URL: "https://example.com/one-too-many", Title: "t"}, time.Now().Add(time.Hour))
	if !errors.Is(err, ErrLimitReached) {
		t.Fatalf("Save past the limit: err=%v, want ErrLimitReached", err)
	}
	if created {
		t.Error("Save past the limit reported created=true")
	}

	pages, _ := List(ctx, user)
	if len(pages) != MaxPerUser {
		t.Fatalf("List: got %d pages, want %d (nothing evicted, nothing added)", len(pages), MaxPerUser)
	}
	if pages[len(pages)-1].URL != oldest {
		t.Fatalf("the oldest page was evicted: last is %q, want %q", pages[len(pages)-1].URL, oldest)
	}
}

func TestResavingAnExistingPageAtTheLimitStillSucceeds(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	first := fillToLimit(t, user)

	page, created, err := Save(ctx, user, Input{URL: first, Title: "t"}, time.Now().Add(time.Hour))
	if err != nil || created || page.URL != first {
		t.Fatalf("re-save at the limit: page=%+v created=%v err=%v, want the existing page, created=false", page, created, err)
	}
}

func TestOwnerCanDeleteASavedPage(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	keep, _, _ := Save(ctx, user, Input{URL: "https://example.com/keep", Title: "keep"}, time.Now())
	drop, _, _ := Save(ctx, user, Input{URL: "https://example.com/drop", Title: "drop"}, time.Now().Add(time.Second))

	if err := Delete(ctx, user, drop.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	pages, _ := List(ctx, user)
	if len(pages) != 1 || pages[0].ID != keep.ID {
		t.Fatalf("after Delete: %+v, want only the page that was kept", pages)
	}
}

func TestDeleteCannotTouchAnotherUsersPageOrAMissingOne(t *testing.T) {
	ctx := context.Background()
	alice, mallory := "u-alice-"+t.Name(), "u-mallory-"+t.Name()
	page, _, _ := Save(ctx, alice, Input{URL: "https://example.com/private", Title: "private"}, time.Now())

	if err := Delete(ctx, mallory, page.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete of another user's page: err=%v, want ErrNotFound", err)
	}
	if err := Delete(ctx, alice, "no-such-id"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete of a missing page: err=%v, want ErrNotFound", err)
	}
	if pages, _ := List(ctx, alice); len(pages) != 1 {
		t.Fatalf("alice's page was affected: %+v", pages)
	}
}

func TestDeleteAllRemovesOnlyThatUsersPages(t *testing.T) {
	ctx := context.Background()
	alice, bob := "u-alice-"+t.Name(), "u-bob-"+t.Name()
	for i := 0; i < 3; i++ {
		Save(ctx, alice, Input{URL: fmt.Sprintf("https://example.com/a%d", i)}, time.Now())
	}
	Save(ctx, bob, Input{URL: "https://example.com/b"}, time.Now())

	deleted, err := DeleteAll(ctx, alice)
	if err != nil || deleted != 3 {
		t.Fatalf("DeleteAll: deleted=%d err=%v, want 3", deleted, err)
	}
	if pages, _ := List(ctx, alice); len(pages) != 0 {
		t.Fatalf("alice still has %d pages", len(pages))
	}
	if pages, _ := List(ctx, bob); len(pages) != 1 {
		t.Fatalf("bob has %d pages, want 1 (untouched)", len(pages))
	}
}

func strPtr(s string) *string { return &s }

func TestOwnerCanEditTheTitle(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	page, _, _ := Save(ctx, user, Input{URL: "https://example.com/a", Title: "old"}, time.Now())

	updated, err := Update(ctx, user, page.ID, Patch{Title: strPtr("my own note")})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Title != "my own note" || updated.URL != "https://example.com/a" {
		t.Fatalf("Update returned %+v, want the new title and the same URL", updated)
	}
	pages, _ := List(ctx, user)
	if len(pages) != 1 || pages[0].Title != "my own note" {
		t.Fatalf("listed after Update: %+v", pages)
	}
}

func TestOwnerCanEditTheURL(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	page, _, _ := Save(ctx, user, Input{URL: "https://example.com/a", Title: "t"}, time.Now())

	updated, err := Update(ctx, user, page.ID, Patch{URL: strPtr("https://www.infoq.com/articles/new-home")})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.URL != "https://www.infoq.com/articles/new-home" || updated.Host != "www.infoq.com" {
		t.Fatalf("Update returned %+v, want the new URL and its host", updated)
	}
	if updated.Title != "t" {
		t.Errorf("editing the URL changed the title to %q", updated.Title)
	}
}

func TestEditingTheURLToAnAlreadySavedPageIsRejected(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	Save(ctx, user, Input{URL: "https://example.com/taken", Title: "taken"}, time.Now())
	other, _, _ := Save(ctx, user, Input{URL: "https://example.com/other", Title: "other"}, time.Now().Add(time.Second))

	_, err := Update(ctx, user, other.ID, Patch{URL: strPtr("https://example.com/taken")})
	if !errors.Is(err, ErrDuplicate) {
		t.Fatalf("Update to a URL already saved: err=%v, want ErrDuplicate", err)
	}

	pages, _ := List(ctx, user)
	if len(pages) != 2 {
		t.Fatalf("got %d pages, want 2", len(pages))
	}
	for _, p := range pages {
		if p.ID == other.ID && p.URL != "https://example.com/other" {
			t.Fatalf("the rejected edit still changed the page to %q", p.URL)
		}
	}
}

func TestEditCannotTouchAnotherUsersPageOrAMissingOne(t *testing.T) {
	ctx := context.Background()
	alice, mallory := "u-alice-"+t.Name(), "u-mallory-"+t.Name()
	page, _, _ := Save(ctx, alice, Input{URL: "https://example.com/private", Title: "private"}, time.Now())

	if _, err := Update(ctx, mallory, page.ID, Patch{Title: strPtr("hijacked")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update of another user's page: err=%v, want ErrNotFound", err)
	}
	if _, err := Update(ctx, alice, "no-such-id", Patch{Title: strPtr("x")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update of a missing page: err=%v, want ErrNotFound", err)
	}
	if pages, _ := List(ctx, alice); pages[0].Title != "private" {
		t.Fatalf("alice's page was modified: %+v", pages[0])
	}
}

func TestLinksThatDifferOnlyByFragmentOrTrackingAreTheSamePage(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()

	first, created, err := Save(ctx, user, Input{URL: "https://example.com/read?id=7&utm_source=x#top", Title: "t"}, time.Now())
	if err != nil || !created {
		t.Fatalf("first Save: created=%v err=%v", created, err)
	}
	if first.URL != "https://example.com/read?id=7" {
		t.Fatalf("stored URL %q, want the normalized form", first.URL)
	}
	second, created, err := Save(ctx, user, Input{URL: "https://EXAMPLE.com/read?id=7&fbclid=zzz", Title: "t"}, time.Now())
	if err != nil || created || second.ID != first.ID {
		t.Fatalf("second Save: id=%q created=%v err=%v, want the first page again", second.ID, created, err)
	}
}

func TestSavingSomethingThatIsNotAWebPageIsRejected(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()

	for _, raw := range []string{"", "javascript:alert(1)", "chrome://extensions", "file:///etc/passwd"} {
		if _, created, err := Save(ctx, user, Input{URL: raw, Title: "t"}, time.Now()); !errors.Is(err, urlnorm.ErrInvalidURL) || created {
			t.Errorf("Save(%q): created=%v err=%v, want ErrInvalidURL", raw, created, err)
		}
	}
	if pages, _ := List(ctx, user); len(pages) != 0 {
		t.Fatalf("a rejected URL was stored: %+v", pages)
	}
}

func TestEditedURLsAreNormalizedAndValidatedLikeSavedOnes(t *testing.T) {
	ctx := context.Background()
	user := "u-" + t.Name()
	page, _, _ := Save(ctx, user, Input{URL: "https://example.com/a", Title: "t"}, time.Now())

	updated, err := Update(ctx, user, page.ID, Patch{URL: strPtr("https://Example.com/b?id=1&utm_source=x#frag")})
	if err != nil || updated.URL != "https://example.com/b?id=1" {
		t.Fatalf("Update: url=%q err=%v, want the normalized URL", updated.URL, err)
	}

	if _, err := Update(ctx, user, page.ID, Patch{URL: strPtr("javascript:alert(1)")}); !errors.Is(err, urlnorm.ErrInvalidURL) {
		t.Fatalf("Update to a non-web URL: err=%v, want ErrInvalidURL", err)
	}
	if pages, _ := List(ctx, user); pages[0].URL != "https://example.com/b?id=1" {
		t.Fatalf("a rejected edit changed the page to %q", pages[0].URL)
	}
}
