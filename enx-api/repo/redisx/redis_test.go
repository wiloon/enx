package redisx

import (
	"crypto/md5"
	"crypto/sha256"
	"fmt"
	"github.com/satori/go.uuid"
	"testing"
)

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

func TestRemove(t *testing.T) {
	foo := GetNewsIdListByScore("feed_news:5", 0, 1567313745273629)
	fmt.Println(foo)
}
