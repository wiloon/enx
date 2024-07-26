package main

import (
	"context"
	"enx-server/enx"
	"enx-server/translate"
	"enx-server/utils"
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	wordCount "enx-server/word"
	"enx-server/youdao"
	"errors"
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"net/http"
	"strings"
	"time"
)

func main() {
	fmt.Println("enx-api start...")

	utils.ViperInit()
	devMode := viper.GetBool("enx.dev-mode")
	fmt.Println("devMode:", devMode)
	// deploy to docker/k8s, disable file output
	logger.Init("CONSOLE", "debug", "enx-api")
	logger.Debug("debug log test")
	logger.Warn("warn log test")
	logger.Warnf("warnf log test %s", "test")
	logger.Sync()
	sqlitex.Init()

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
	// get words query count by paragraph
	router.GET("/words-count", WordsCount)
	router.GET("/load-count", wordCount.LoadCount)
	router.POST("/mark", MarkWord)

	router.GET("/do-search", DoSearch)
	router.GET("/third-party", DoSearchThirdParty)
	router.GET("/wrap", Wrap)
	router.GET("/translate", translate.Translate)

	port := viper.GetInt("enx.port")
	listenAddress := fmt.Sprintf(":%d", port)
	srv := &http.Server{Addr: listenAddress, Handler: router}

	idleConnectionsClosed := make(chan struct{})
	go func() {
		utils.WaitSignals()
		if err := srv.Shutdown(context.Background()); err != nil {
			logger.Errorf("http server shutdown: %v", err)
		}
		close(idleConnectionsClosed)
	}()

	logger.Infof("listen start, port: %v", port)
	if err := srv.ListenAndServe(); err != nil || !errors.Is(err, http.ErrServerClosed) {
		logger.Errorf("failed to listen, %v", err)
	}
	logger.Infof("listen end")
	<-idleConnectionsClosed

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

func WordsCount(c *gin.Context) {
	paragraph := c.Query("words")
	logger.Debugf("words count, words: %s", paragraph)
	out := enx.QueryCountInText(paragraph)
	c.JSON(200, gin.H{
		"data": out,
	})
}

func MarkWord(c *gin.Context) {
	word := enx.Word{}
	// set key
	err := c.BindJSON(&word)
	if err != nil {
		return
	}
	logger.Debugf("mark word: %s", word.Key)
	word.Translate()

	ud := enx.UserDict{}
	ud.WordId = word.Id
	ud.Mark()
	word.FindQueryCount()
	c.JSON(200, word)
}
