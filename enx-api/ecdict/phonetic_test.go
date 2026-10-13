package ecdict

import (
	"context"
	"testing"

	"enx-api/ecdict/ecdicttest"
)

// Real stardict.phonetic values from ECDICT 1.0.28.
func TestCleanPhonetic(t *testing.T) {
	cases := map[string]string{
		`ju:ni'v\\:sәli`:         "ju:ni'vә:sәli",
		`'p\\:mәntli`:            "'pә:mәntli",
		`di's\\:nәbl,-'z\\:-`:    "di'sә:nәbl,-'zә:-",
		`,dʒ\\: nә'listik`:       ",dʒә:nә'listik",
		`di't\\ : rәbl`:          "di'tә:rәbl",
		`pә'klɔ:rineit, p\\ : -`: "pә'klɔ:rineit, pә:-",
		`'\\:θbajnd`:             "'ә:θbajnd",
		// Intact values are returned as they are.
		"nә:s": "nә:s",
		"[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətəːri]": "[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətəːri]",
		"": "",
	}
	for in, want := range cases {
		if got := CleanPhonetic(in); got != want {
			t.Errorf("CleanPhonetic(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFindCleansPhonetic(t *testing.T) {
	use(t, ecdicttest.Row{Word: "universally", Phonetic: `ju:ni'v\\:sәli`, Translation: "adv. 普遍"})

	row, _, err := Find(context.Background(), "universally")
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if row.Phonetic != "ju:ni'vә:sәli" {
		t.Errorf("Phonetic = %q, want the repaired long schwa", row.Phonetic)
	}
}
