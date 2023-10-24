package main

import (
	"context"
	"enx-server/enx"
	"enx-server/storage/sqlitex"
	"enx-server/utils"
	"enx-server/utils/config"
	"enx-server/utils/logger"
	"enx-server/youdao"
	"flag"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"net/http"
	"regexp"
	"strings"
	"time"
)

func main() {
	configPath := flag.String("config", "config.toml", "config file full path")
	flag.Parse()
	config.LoadConfigByPath(*configPath)
	logger.Init("CONSOLE", "debug", "enx-api")
	sqlitex.Init("/var/lib/enx-api/enx.db")

	// ReleaseMode
	gin.SetMode(gin.DebugMode)
	router := gin.Default()

	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET"},
		AllowHeaders:     []string{"Origin"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

	router.GET("/load-count", LoadCount)
	router.POST("/mark", MarkWord)
	router.GET("/words-count", WordsCount)

	router.GET("/do-search", DoSearch)
	router.GET("/third-party", DoSearchThirdParty)
	router.GET("/wrap", Wrap)
	router.GET("/translate", Translate)

	srv := &http.Server{Addr: ":8080", Handler: router}

	idleConnsClosed := make(chan struct{})
	go func() {
		utils.WaitSignals()
		if err := srv.Shutdown(context.Background()); err != nil {
			logger.Errorf("http server shutdown: %v", err)
		}
		close(idleConnsClosed)
	}()

	logger.Infof("listen start")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Errorf("failed to listen, %v", err)
	}
	logger.Infof("listen end")
	<-idleConnsClosed

}

type SearchResult struct {
	WordList []string
	Dict     *enx.Dictionary
}

func DoSearch(c *gin.Context) {
	key := c.Query("key")
	logger.Infof("key: %v", key)
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
	logger.Infof("key: %v", key)
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
	logger.Debugf(text)
	text = strings.ReplaceAll(text, "\n", " ")
	arr := strings.Split(text, " ")
	a := article{}
	a.WidthMax = 80
	for _, v := range arr {
		a.appendWords(v)
	}
	c.JSON(200, a.Lines)
}
func LoadCount(c *gin.Context) {
	key := c.Query("words")
	words := strings.Split(key, "_")
	response := make(map[string]int)
	for _, word := range words {
		ecp := enx.Word{}
		ecp.SetEnglish(word)
		loadCount := ecp.FindLoadCount()
		response[ecp.English] = loadCount
	}

	c.JSON(200, gin.H{
		"data": response,
	})
}
func Translate(c *gin.Context) {
	english := c.Query("word")
	logger.Debugf("translate word: %s", english)
	english = regexp.MustCompile(`[^a-zA-Z\- ]+`).ReplaceAllString(english, "")
	word := enx.Word{}
	word.SetEnglish(english)

	word.FindChinese()
	if word.Chinese == "" {
		logger.Debugf("find from youdao: %s", english)
		epc := youdao.Query(english)
		word.Chinese = epc.Chinese
		word.Pronunciation = epc.Pronunciation
		word.LoadCount = 1
		word.Save()
	} else {
		word.LoadCount = word.LoadCount + 1
		word.UpdateLoadCount()
	}
	c.JSON(200, word)
}

func WordsCount(c *gin.Context) {
	words := c.Query("words")
	logger.Debugf("words count, words: %s", words)
	WordsCount0 := enx.WordsCount0(words)
	c.JSON(200, gin.H{
		"data": WordsCount0,
	})
}

func MarkWord(c *gin.Context) {
	word := enx.Word{}

	err := c.BindJSON(&word)
	if err != nil {
		return
	}
	logger.Debugf("mark word: %s", word.Key)
	word.FindChinese()

	ud := enx.UserDict{}
	ud.WordId = word.Id
	ud.Mark()

	c.JSON(200, ud)
}
