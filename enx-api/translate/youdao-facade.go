package translate

import "enx-server/youdao"

func YouDaoTranslate(word string) {
	youdaoResult := youdao.Translate(word)
	_ = youdaoResult
}
