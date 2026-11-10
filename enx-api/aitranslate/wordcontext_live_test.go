package aitranslate_test

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"enx-api/aitranslate"
	"enx-api/config"
)

type wordContextExpectation int

const (
	// whyRelatesToDictionary: the dictionary doesn't cover the contextual
	// meaning, so why must explain it.
	whyRelatesToDictionary wordContextExpectation = iota
	// whyEmptyCovered: the contextual meaning is an ordinary sense the
	// dictionary lists, so why must be empty.
	whyEmptyCovered
	// whyBorderline: a mild extension of a short gloss; logged for the owner
	// to judge, not asserted.
	whyBorderline
)

// dictionaryChinese values are raw ECDICT translation fields, newlines kept.
var wordContextSamples = []struct {
	name              string
	sentence          string
	word              string
	dictionaryChinese string
	expect            wordContextExpectation
}{
	{
		name:              "straggled",
		sentence:          "On the road the distanced wedding guests straggled in pairs and groups.",
		word:              "straggled",
		dictionaryChinese: "v. 蔓延( straggle的过去式和过去分词 ); 散漫; 落伍; 落后",
		expect:            whyRelatesToDictionary,
	},
	{
		name:              "tips",
		sentence:          "When prices keep rising, public opinion tips toward reform.",
		word:              "tips",
		dictionaryChinese: "n. 秘诀, 技巧；小贴士, 小窍门",
		expect:            whyRelatesToDictionary,
	},
	{
		name:              "weathered",
		sentence:          "The small company weathered the recession better than its rivals.",
		word:              "weathered",
		dictionaryChinese: "a. 风化的, 倾斜的",
		expect:            whyRelatesToDictionary,
	},
	{
		name:              "hinges",
		sentence:          "The whole plan hinges on whether the council approves the funding.",
		word:              "hinges",
		dictionaryChinese: "n. 铰链( hinge的名词复数 )",
		expect:            whyRelatesToDictionary,
	},
	{
		name:              "door",
		sentence:          "She opened the door and walked into the kitchen.",
		word:              "door",
		dictionaryChinese: "n. 门",
		expect:            whyEmptyCovered,
	},
	{
		name:              "car",
		sentence:          "He bought a new car last week and drove it to work.",
		word:              "car",
		dictionaryChinese: "n. 汽车, 客车\n[机] 车",
		expect:            whyEmptyCovered,
	},
	{
		name:              "river",
		sentence:          "The children swam in the river behind the village every summer.",
		word:              "river",
		dictionaryChinese: "n. 河, 江\n[法] 河流, 江河, 内河",
		expect:            whyEmptyCovered,
	},
	{
		name:              "thin",
		sentence:          "The evidence against him was too thin to bring the case to trial.",
		word:              "thin",
		dictionaryChinese: "a. 薄的, 细的, 瘦的, 稀疏的, 稀薄的, 淡的, 弱的, 空洞的\nvt. 使变薄, 使变细, 使稀少, 使淡\nvi. 变薄, 变细, 变少, 变淡\nadv. 薄地, 稀疏地, 微弱地\nn. 细小部分",
		expect:            whyBorderline,
	},
	{
		name:              "devoured",
		sentence:          "She devoured the novel in a single evening.",
		word:              "devoured",
		dictionaryChinese: "v. 吞没( devour的过去式和过去分词 ); 耗尽; 津津有味地看; 狼吞虎咽地吃光",
		expect:            whyBorderline,
	},
	{
		name:              "fielded",
		sentence:          "The minister fielded questions from reporters for nearly an hour.",
		word:              "fielded",
		dictionaryChinese: "vi. [棒球、板球等]担任外场员, 担任守队队员（field的过去式与过去分词形式）",
		expect:            whyBorderline,
	},
	{
		name:              "broke",
		sentence:          "I can't come out tonight; I'm broke until payday.",
		word:              "broke",
		dictionaryChinese: "a. 一文不名的\nbreak的过去式",
		expect:            whyBorderline,
	},
	{
		name:              "sharp",
		sentence:          "There was a sharp rise in food prices last month.",
		word:              "sharp",
		dictionaryChinese: "n. 半升音调, 利刃, 骗子\na. 锋利的, 明显的, 敏锐的, 急剧的, 尖刻的, 严厉的, 刺耳的, 精明的\nadv. 锐利地, 急速地",
		expect:            whyBorderline,
	},
}

var negatingWhy = regexp.MustCompile(`非.*之意|而不是|并非`)

// TestLiveWordContextWhyRelatesMeaningToDictionary sends real sentences
// through the production word-in-context prompt, user content and parser on
// OpenRouter. Opt-in: it runs only when an OpenRouter API key is configured
// (OPENROUTER_API_KEY or config.toml), and honours
// SENTENCE_TRANSLATE_OPENROUTER_MODEL.
func TestLiveWordContextWhyRelatesMeaningToDictionary(t *testing.T) {
	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	if cfg.SentenceTranslate.OpenRouter.APIKey == "" {
		t.Skip("no OpenRouter API key configured (OPENROUTER_API_KEY); live sample test skipped")
	}
	cfg.SentenceTranslate.Provider = "openrouter"

	ctx := context.Background()
	translator, err := aitranslate.New(ctx, cfg.SentenceTranslate)
	if err != nil {
		t.Fatalf("aitranslate.New: %v", err)
	}

	model := cfg.SentenceTranslate.OpenRouter.Model
	if model == "" {
		model = "(openrouter provider default)"
	}
	t.Logf("effective model: %s", model)

	totalPromptTokens := 0
	for _, s := range wordContextSamples {
		t.Run(s.name, func(t *testing.T) {
			callCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()

			got, usage, err := translator.TranslateWordInContext(callCtx, s.sentence, s.word, s.dictionaryChinese)
			if err != nil {
				t.Fatalf("TranslateWordInContext: %v", err)
			}
			totalPromptTokens += usage.PromptTokens
			t.Logf("model=%s\nsentence: %s\nword: %s\ndictionary: %q\n-> word: %s\n-> why: %s\nprompt tokens: %d",
				model, s.sentence, s.word, s.dictionaryChinese, got.WordChinese, got.Why, usage.PromptTokens)

			if got.WordChinese == "" {
				t.Errorf("word is empty")
			}
			if negatingWhy.MatchString(got.Why) || strings.HasPrefix(got.Why, "不是") {
				t.Errorf("why negates dictionary senses: %q", got.Why)
			}
			switch s.expect {
			case whyRelatesToDictionary:
				if got.Why == "" {
					t.Errorf("why is empty, want an explanation for a meaning the dictionary doesn't cover")
				}
			case whyEmptyCovered:
				if got.Why != "" {
					t.Errorf("why = %q, want empty for a sense the dictionary covers", got.Why)
				}
			case whyBorderline:
				t.Logf("borderline case: judge by eye")
			}
		})
	}
	t.Logf("total prompt tokens across %d samples: %d", len(wordContextSamples), totalPromptTokens)
}
