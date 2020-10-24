package main

import (
	"enx-server/enx"
	"github.com/gin-gonic/gin"
	log "github.com/wiloon/pingd-log/logconfig/zaplog"
	"github.com/wiloon/pingd-utils/utils"
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
	c.JSON(200, result)
}
