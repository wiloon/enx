package main

import (
	"enx-server/enx"
	"enx-server/youdao"
	"github.com/gin-gonic/gin"
	log "github.com/wiloon/pingd-log/logconfig/zaplog"
	"github.com/wiloon/pingd-utils/utils"
	"strings"
)

func main() {
	log.Init()

	router := gin.Default()
	router.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

	router.GET("/do-search", DoSearch)
	router.GET("/third-party", DoSearchThirdParty)
	router.GET("/wrap", Wrap)

	err := router.Run()
	handleErr(err)
	log.Info("enx server started and listening default port of gin")
	utils.WaitSignals()
}
func handleErr(e error) {
	if e != nil {
		log.Info(e.Error())
	}
}

type SearchResult struct {
	WordList []string
	Dict     *enx.Dictionary
}

func DoSearch(c *gin.Context) {
	key := c.Query("key")
	log.Infof("key: %v", key)
	words := enx.Search(key)

	result := SearchResult{}
	result.WordList = words
	result.Dict = enx.FindOne(key)
	if result.Dict == nil || result.Dict.Chinese == "" {
		// 从第三方查
		chinese := youdao.Query(key)
		result.Dict = &enx.Dictionary{
			English: key,
			Chinese: chinese,
		}

	}
	c.JSON(200, result)
}

func DoSearchThirdParty(c *gin.Context) {
	key := c.Query("key")
	log.Infof("key: %v", key)
	words := enx.Search(key)

	result := SearchResult{}
	result.WordList = words

	// 从第三方查
	chinese := youdao.Query(key)
	result.Dict = &enx.Dictionary{
		English: key,
		Chinese: chinese,
	}

	c.JSON(200, result)
}

func Wrap(c *gin.Context) {
	text := c.Query("text")
	arr := strings.Split(text, " ")
	c.JSON(200, arr)
}
