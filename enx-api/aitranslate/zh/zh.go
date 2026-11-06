// Package zh holds the prompt rules every AI call that writes Chinese shares.
// It is a leaf package, so each prompt's contract package (sentence,
// sentenceword, wordcontext, worddef, rephrase) can build its SystemPrompt
// from these constants without an import cycle.
package zh

// SimplifiedRule pins the script. Told only "Chinese", models sometimes
// answer in Traditional Chinese, especially for text from Taiwanese or Hong
// Kong sources. Everything the app stores and shows is Simplified Chinese.
const SimplifiedRule = "- Write all Chinese in Simplified Chinese characters (简体中文, as used in mainland China). " +
	"Never use Traditional Chinese characters, even when the English text comes from Taiwan or Hong Kong."
