package sentence

import (
	"errors"
	"testing"
)

func TestCheckRejectsABlankTranslation(t *testing.T) {
	for _, raw := range []string{"", "   ", "\n\t"} {
		if err := Check(raw); !errors.Is(err, ErrEmptyTranslation) {
			t.Errorf("Check(%q) = %v, want ErrEmptyTranslation", raw, err)
		}
	}
}

func TestCheckAcceptsATranslation(t *testing.T) {
	for _, raw := range []string{"你好", " 你好 "} {
		if err := Check(raw); err != nil {
			t.Errorf("Check(%q) = %v, want nil", raw, err)
		}
	}
}
