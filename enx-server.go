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
	router.GET("/translate", Translate)

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
		epc := youdao.Query(key)
		result.Dict = epc

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
	epc := youdao.Query(key)
	result.Dict = epc

	c.JSON(200, result)
}

type article struct {
	WidthMax int `json:"-"`
	Lines    []*line
}

func (a *article) appendWords(word string) {
	if len(a.Lines) == 0 {
		a.Lines = append(a.Lines, &line{})
	}
	tmp := a.Lines[len(a.Lines)-1]
	lineWidth := tmp.appendWords(word)
	if lineWidth > a.WidthMax {
		a.Lines = append(a.Lines, &line{})
	}
}

type line struct {
	width int
	Words []string
}

func (l *line) appendWords(word string) int {
	l.Words = append(l.Words, word)
	l.width = l.width + len(word) + 1
	return l.width
}

func Wrap(c *gin.Context) {
	text := c.Query("text")
	log.Debugf(text)
	text = strings.ReplaceAll(text, "\n", " ")
	arr := strings.Split(text, " ")
	a := article{}
	a.WidthMax = 80
	for _, v := range arr {
		a.appendWords(v)
	}
	c.JSON(200, a.Lines)
}
func Translate(c *gin.Context) {
	word := c.Query("word")
	word = strings.ReplaceAll(word, ".", "")
	epc := enx.FindOne(word)
	if epc == nil || epc.English == "" {
		log.Debugf("find from youdao: %s", word)
		epc = youdao.Query(word)
	}
	c.JSON(200, epc)
}
