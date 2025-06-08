package enx

import (
	"enx-server/repo"
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"regexp"
	"strings"
	"time"
)

type Word struct {
	// id in DB
	Id int
	// raw paragraph item, e.g. `morning.`
	Raw string
	// english word, e.g. `morning`
	English       string
	Chinese       string
	Pronunciation string
	// key is lower case of english word, e.g. `morning`
	Key string

	// 0: false, 1: true
	AlreadyAcquainted int
	LoadCount         int
	// 0: default: normal type
	// 1: raw: this word would not be translated
	WordType int
}

func (word *Word) SetEnglish(raw string) {
	raw = regexp.MustCompile(`[^a-zA-Z\-'’ ]+`).ReplaceAllString(raw, "")

	english := ""
	if strings.Contains(raw, "'s") ||
		strings.Contains(raw, "’s") ||
		strings.Contains(raw, "'t") ||
		strings.Contains(raw, "'ve") ||
		strings.Contains(raw, "'m") ||
		strings.Contains(raw, "'d") ||
		strings.Contains(raw, "'re") {
		// do nothing
		english = raw
		logger.Infof("set english no replace, raw: %s, english: %s", raw, english)
	} else {
		english = raw
		english = strings.TrimSuffix(english, "-")
		english = strings.TrimSuffix(english, "’")
		english = strings.TrimSuffix(english, ".")
		english = strings.TrimSuffix(english, ",")
		english = strings.TrimPrefix(english, "(")
		english = strings.TrimSuffix(english, ")")
		english = regexp.MustCompile(`[^a-zA-Z\-’ ]+`).ReplaceAllString(english, "")
		logger.Debugf("replace non english char, raw: %s, english: %s", raw, english)
	}

	// if english end with - or space, remove it
	if strings.HasSuffix(english, "-") || strings.HasSuffix(english, " ") {
		english = english[:len(english)-1]
	}
	word.Raw = raw
	word.SetEnglishField(english)
}

// count by english
func (word *Word) CountByEnglish() int {
	count := repo.CountByEnglish(word.English)
	return count
}
func (word *Word) FindId() {
	sWord := repo.GetWordByEnglish(word.English)
	word.Id = sWord.Id
}

func (word *Word) LoadByEnglish() {
	sWord := repo.GetWordByEnglish(word.English)
	word.Id = sWord.Id
	word.English = sWord.English
	word.Chinese = sWord.Chinese
	word.Pronunciation = sWord.Pronunciation
	word.LoadCount = sWord.LoadCount
	logger.Debugf("load by english, word: %s, id: %d", word.English, word.Id)
}

func (word *Word) SetEnglishField(english string) {
	if strings.Contains(english, "'s") {
		tmpKey := strings.Replace(english, "'s", "", -1)
		word.English = tmpKey
		word.Key = strings.ToLower(tmpKey)
	} else if strings.Contains(english, "’s") {
		tmpKey := strings.Replace(english, "’s", "", -1)
		word.English = tmpKey
		word.Key = strings.ToLower(tmpKey)
	} else {
		word.English = english
		word.Key = strings.ToLower(english)
	}
	logger.Infof("set english, raw: %s, english: %s, key: %s", word.Raw, word.English, word.Key)
}
func (word *Word) FindQueryCount(userId int) int {
	qc, acquainted := repo.GetUserWordQueryCount(word.Id, userId)
	logger.Debugf("find query count, word id: %d, word: %s, user_id: %d, query count: %d",
		word.Id, word.English, userId, qc)
	word.LoadCount = qc
	word.AlreadyAcquainted = acquainted
	return qc
}

func (word *Word) FindLoadCountById() int {
	sqlitex.DB.Table("words").Where("words.id=?", word.Id).Scan(&word)
	logger.Debugf("find one load count, word: %+v", word)
	return word.LoadCount
}

func (word *Word) Translate(userId int64) *Word {
	// tmp function, remove duplicate word
	word.RemoveDuplicateWord()
	// search word in db by English, e.g. French
	// do not search db with lower case, since youdao api is case sensitive

	if userId == 0 {
		logger.Errorf("no valid user id provided")
		return word
	}

	sWord := repo.Translate(word.English, int(userId))
	word.Id = sWord.Id
	word.Chinese = sWord.Chinese
	word.Pronunciation = sWord.Pronunciation

	word.LoadCount = sWord.LoadCount
	if sWord.Id != 0 {
		// 查询 user_dicts 表
		sud := UserDict{}
		sqlitex.DB.Table("user_dicts").
			Where("word_id=? and user_id=?", sWord.Id, userId).Scan(&sud)
		if sud.WordId != 0 {
			word.LoadCount = sud.QueryCount
		}
	}

	logger.Infof("word translate result, id: %v, english: %s", sWord.Id, word.Key)
	return word
}

func (word *Word) RemoveDuplicateWord() {
	// count by english
	count := repo.CountByEnglish(word.English)

	if count > 1 {
		// delete duplicate word
		tmp_word := repo.GetWordByEnglishCaseSensitive(word.English)
		repo.DeleteDuplicateWord(word.English, tmp_word.Id)
	}
}

func (word *Word) Save() {
	sWord := repo.Word{}
	sWord.CreateDatetime = time.Now()
	sWord.UpdateDatetime = time.Now()
	sWord.English = word.English
	sWord.Chinese = word.Chinese
	sWord.Pronunciation = word.Pronunciation
	sWord.LoadCount = word.LoadCount
	tx := sqlitex.DB.Create(&sWord)
	logger.Debugf("save word: %v, tx: %v", sWord, tx)
	word.Id = sWord.Id
}

func (word *Word) UpdateLoadCount() {
	sWord := repo.Word{}
	sqlitex.DB.Model(&sWord).
		Where("english=?", word.Key).
		Updates(map[string]interface{}{
			"load_count":      word.LoadCount,
			"update_datetime": time.Now()})
	logger.Debugf("update word: %v", word)
}
