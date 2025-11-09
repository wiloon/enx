package translate

import "enx-api/youdao"

func YouDaoTranslate(word string) {
	youdaoResult := youdao.Translate(word)
	_ = youdaoResult
}
