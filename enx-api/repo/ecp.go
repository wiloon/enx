package repo

import (
	"context"
	"enx-api/dataservice"
	pb "enx-api/proto"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"time"
)

type Word struct {
	Id             int
	English        string
	LoadCount      int
	Chinese        string
	Pronunciation  string
	CreateDatetime time.Time
	UpdateDatetime time.Time
}

type UserDict struct {
	WordId     int
	QueryCount int
	// default user id is 1
	UserId            int `json:"user_id" gorm:"default:1"`
	AlreadyAcquainted int
	UpdateTime        time.Time
}

type YoudaoQueryHistory struct {
	English string
	Result  string
	Exist   int
}

// GetWordByEnglish get word id by english
func GetWordByEnglish(english string) *Word {
	client := dataservice.GetGlobalClient()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pbWord, err := client.GetWordByEnglish(ctx, english)
	if err != nil {
		logger.Debugf("word not found: %s, error: %v", english, err)
		return &Word{} // Return empty word for compatibility
	}

	word := pbWordToRepoWord(pbWord)
	logger.Debugf("find word via gRPC, id: %s, english: %s", pbWord.Id, pbWord.English)
	return word
}

func GetWordByEnglishCaseSensitive(english string) *Word {
	// gRPC GetWordByEnglish already does case-insensitive matching
	// For case-sensitive, we'll use the same method for now
	// TODO: Add case-sensitive RPC if needed
	return GetWordByEnglish(english)
}

// GetUserWordQueryCount get user word query count
func GetUserWordQueryCount(wordId, userId int) (int, int) {
	sud := UserDict{}
	sud.UserId = userId
	sud.WordId = wordId

	sqlitex.DB.Table("user_dicts").
		Where("user_dicts.word_id=? and user_dicts.user_id=?", sud.WordId, sud.UserId).Scan(&sud)
	return sud.QueryCount, sud.AlreadyAcquainted
}

func Translate(key string, userId int) Word {
	client := dataservice.GetGlobalClient()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pbWord, err := client.GetWordByEnglish(ctx, key)
	if err != nil {
		logger.Debugf("word not found via gRPC: %s, error: %v", key, err)
		return Word{} // Return empty word
	}

	word := pbWordToRepoWord(pbWord)
	logger.Debugf("find in data-service via gRPC, id: %s, english: %s, user_id: %d", pbWord.Id, key, userId)
	return *word
}

// IsYouDaoRecordExist check if youdao dict response exist in db
func IsYouDaoRecordExist(words string) (bool, bool, *YoudaoQueryHistory) {
	cacheHit := false
	youdaoCanHandleThisWord := false
	yd := YoudaoQueryHistory{}
	sqlitex.DB.Where("english=?", words).Find(&yd)

	if yd.English != "" {
		cacheHit = true
	}
	if cacheHit && yd.Exist == 1 {
		youdaoCanHandleThisWord = true
	}
	logger.Debugf("check if youdao record exist, english: %s, cache hit: %v, youdao has this word: %v", words, cacheHit, youdaoCanHandleThisWord)
	return cacheHit, youdaoCanHandleThisWord, &yd
}

// SaveYouDaoDictResponse save youdao dict response to db
func SaveYouDaoDictResponse(word, response string, exist int) {
	yqh := YoudaoQueryHistory{}
	yqh.English = word
	yqh.Result = response
	yqh.Exist = exist
	sqlitex.DB.Create(&yqh)
}

func CountByEnglish(english string) int {
	client := dataservice.GetGlobalClient()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Use GetWordByEnglish to check if word exists
	_, err := client.GetWordByEnglish(ctx, english)
	if err != nil {
		logger.Debugf("count by english via gRPC, word: %s, count: 0", english)
		return 0
	}

	logger.Debugf("count by english via gRPC, word: %s, count: 1", english)
	return 1
}

func DeleteDuplicateWord(english string, excludeId int) {
	// This function is no longer needed with UUID-based P2P system
	// Duplicates are prevented by unique constraint on english field
	logger.Debugf("DeleteDuplicateWord called but skipped (P2P system prevents duplicates), english: %s, excluding id: %d", english, excludeId)
}

// pbWordToRepoWord converts protobuf Word to repo Word
func pbWordToRepoWord(pbWord *pb.Word) *Word {
	if pbWord == nil {
		return &Word{}
	}

	word := &Word{
		Id:            0, // TODO: Handle UUID to int conversion if needed
		English:       pbWord.English,
		Chinese:       pbWord.Chinese,
		Pronunciation: pbWord.Pronunciation,
		LoadCount:     0, // Not in protobuf, keep as 0
	}

	// Convert Unix milliseconds to time.Time
	if pbWord.CreatedAt > 0 {
		word.CreateDatetime = time.Unix(pbWord.CreatedAt/1000, (pbWord.CreatedAt%1000)*int64(time.Millisecond))
	}
	if pbWord.UpdatedAt > 0 {
		word.UpdateDatetime = time.Unix(pbWord.UpdatedAt/1000, (pbWord.UpdatedAt%1000)*int64(time.Millisecond))
	}

	return word
}
