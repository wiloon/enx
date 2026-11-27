package wordform

import "testing"

func TestKeyCanonicalisesBeforeLowerCasing(t *testing.T) {
	for word, want := range map[string]string{
		"Don’t": "don't",
		"Dog's": "dog",
		"DOG'S": "dog's", // Canonical strips only a lowercase 's
		"'s":    "",
	} {
		if got := Key(word); got != want {
			t.Errorf("Key(%q) = %q, want %q", word, got, want)
		}
	}
}
