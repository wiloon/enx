package redisx

import (
	"crypto/md5"
	"crypto/sha256"
	"fmt"
	"github.com/satori/go.uuid"
	"os"
	"rssx/utils"
	"rssx/utils/config"
	log "rssx/utils/logger"
	"testing"
)

func Test00(t *testing.T) {
	GetScoreByRank("read_index:0:5", 0)
}
func TestUUID(t *testing.T) {
	rootUUID, _ := uuid.FromString("5e4a8cfe-73df-4ca6-8089-18c189cc1aa3")

	for i := 0; i < 10; i++ {
		newsUUID := uuid.NewV5(rootUUID, "news_id")
		fmt.Println(newsUUID)
	}

}

func TestShar(t *testing.T) {
	s := "sha256 芳华"

	h := sha256.New()
	h.Write([]byte(s))
	bs := h.Sum(nil)

	fmt.Printf("origin: %s, sha256 hash: %x\n", s, bs)

}

func TestMd5(t *testing.T) {
	s := "test str"
	data := []byte(s)
	has := md5.Sum(data)
	md5str1 := fmt.Sprintf("%x", has) //将[]byte转成16进制

	fmt.Println(md5str1)

}

func Test0(t *testing.T) {
	log.Infof("start...")
	_ = os.Setenv("app_config", "/tmp/rssx-config-toml")
	config.LoadLocalConfig("rssx-config-toml")

	key := "k0"
	score0 := utils.TimeNowMicrosecond()
	log.Infof("score0: %v", score0)
	ZADD("k0", score0, "news0")
	score1 := utils.TimeNowMicrosecond()
	log.Infof("score1: %v", score1)
	ZADD("k0", score1, "news1")
	score2 := utils.TimeNowMicrosecond()
	log.Infof("score2: %v", score2)
	ZADD("k0", score2, "news2")

	r, _ := GetConn().Do("ZRANGEBYSCORE", "k0", score1, score1)
	foo := r.([]interface{})
	s := string(foo[0].([]byte))
	log.Info("get member by score, member: " + s)

	r = GetRankByScore("k0", score1)
	log.Infof("get index by score, score: %v, index: %v", score1, r)

	score := GetScoreByRank(key, 0)
	log.Infof("get score by rank, rank:%v, score: %v", 0, score)

	score = GetScoreByRank(key, 1)
	log.Infof("get score by rank, rank:%v, score: %v", 1, score)

	score = GetScoreByRank(key, 2)
	log.Infof("get score by rank, rank:%v, score: %v", 2, score)
}

func TestRemove(t *testing.T) {
	config.LoadLocalConfig("config.toml")
	foo := GetNewsIdListByScore("feed_news:5", 0, 1567313745273629)
	fmt.Println(foo)
}
