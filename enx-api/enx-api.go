package main

import (
	"context"
	"enx-server/enx"
	"enx-server/handlers"
	"enx-server/middleware"
	"enx-server/paragraph"
	"enx-server/translate"
	"enx-server/utils"
	"enx-server/utils/logger"
	"enx-server/utils/password"
	"enx-server/utils/sqlitex"
	wordCount "enx-server/word"
	"enx-server/youdao"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
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

	// Add detailed CORS and request logging middleware BEFORE CORS
	router.Use(func(c *gin.Context) {
		logger.Infof("=== PRE-CORS Request Start ===")
		logger.Infof("Request: %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Infof("Headers: X-Session-ID='%s', Content-Type='%s', Origin='%s', Cookie='%s'",
			c.GetHeader("X-Session-ID"), c.GetHeader("Content-Type"), c.GetHeader("Origin"), c.GetHeader("Cookie"))
		logger.Infof("User-Agent: %s", c.GetHeader("User-Agent"))

		c.Next()

		logger.Infof("PRE-CORS Response: %d for %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
		logger.Infof("=== PRE-CORS Request End ===")
	})

	// Custom CORS middleware to support chrome-extension origins
	router.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		// List of allowed origins
		allowedOrigins := []string{
			"http://localhost:3000",
			"https://enx-ui.wiloon.com",
			"https://enx-dev.wiloon.com",
		}

		// Check if origin is allowed or is a chrome extension
		isAllowed := false
		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				isAllowed = true
				break
			}
		}

		// Also allow chrome extensions
		if !isAllowed && len(origin) > 0 && (origin[:17] == "chrome-extension:" || origin[:16] == "moz-extension:") {
			isAllowed = true
		}

		if isAllowed {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
			c.Header("Access-Control-Allow-Headers", "Origin, X-Session-ID, X-User-ID, Content-Type, Cookie")
			c.Header("Access-Control-Expose-Headers", "Content-Length")
			c.Header("Access-Control-Max-Age", "43200") // 12 hours
		}

		// Handle preflight requests
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Add detailed CORS and request logging middleware AFTER CORS
	router.Use(func(c *gin.Context) {
		logger.Infof("=== Request Start ===")
		logger.Infof("Request: %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Infof("Headers: X-Session-ID='%s', Content-Type='%s', Origin='%s', Cookie='%s'",
			c.GetHeader("X-Session-ID"), c.GetHeader("Content-Type"), c.GetHeader("Origin"), c.GetHeader("Cookie"))
		logger.Infof("User-Agent: %s", c.GetHeader("User-Agent"))

		// Check if this is a preflight request
		if c.Request.Method == "OPTIONS" {
			logger.Infof("CORS Preflight request detected")
		}

		c.Next()

		logger.Infof("Response: %d for %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
		logger.Infof("Response Headers: %+v", c.Writer.Header())
		logger.Infof("=== Request End ===")
	})

	router.GET("/ping", Ping)

	// Version information API - no authentication required
	router.GET("/version", handlers.GetVersion)
	router.GET("/api/version", handlers.GetVersionSimple)

	// APIs requiring authentication
	authGroup := router.Group("/")
	authGroup.Use(middleware.SessionMiddleware())
	{
		// get words query count by paragraph
		authGroup.GET("/paragraph-init", paragraph.ParagraphInit)

		// translate
		authGroup.GET("/translate", translate.Translate)
		authGroup.GET("/word/:word", translate.TranslateByWord)
		authGroup.GET("/load-count", wordCount.LoadCount)
		authGroup.POST("/mark", MarkWord)
		authGroup.GET("/do-search", DoSearch)
		authGroup.GET("/third-party", DoSearchThirdParty)
		authGroup.GET("/wrap", Wrap)
		authGroup.POST("/log", LogHandler)
	}

	// API group for Kong gateway (with /api prefix)
	apiGroup := router.Group("/api")
	apiGroup.Use(middleware.SessionMiddleware())
	{
		// get words query count by paragraph
		apiGroup.GET("/paragraph-init", paragraph.ParagraphInit)

		// translate
		apiGroup.GET("/translate", translate.Translate)
		apiGroup.GET("/word/:word", translate.TranslateByWord)
		apiGroup.GET("/load-count", wordCount.LoadCount)
		apiGroup.POST("/mark", MarkWord)
		apiGroup.GET("/do-search", DoSearch)
		apiGroup.GET("/third-party", DoSearchThirdParty)
		apiGroup.GET("/wrap", Wrap)
		apiGroup.POST("/log", LogHandler)
	}

	// APIs not requiring authentication
	router.POST("/login", Login)
	router.POST("/logout", Logout)
	router.POST("/register", Register)

	// 临时测试路由 - 不需要认证
	router.POST("/mark-test", MarkWord)

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

	logger.Infof("enx api listening port: %v", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Errorf("failed to listen, %v", err)
		logger.Error("server failed to start, exiting...")
		os.Exit(1)
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
		// query from third party
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

	// query from third party
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

func MarkWord(c *gin.Context) {
	logger.Infof("MarkWord: Starting mark word request")

	word := enx.Word{}
	// set key
	err := c.BindJSON(&word)
	if err != nil {
		logger.Errorf("MarkWord: Failed to bind JSON: %v", err)
		c.JSON(400, gin.H{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}
	logger.Infof("MarkWord: Successfully parsed word: %s", word.English)
	word.Key = strings.ToLower(word.English)

	// Get user ID from session context
	userId := middleware.GetUserIDFromContext(c)
	logger.Infof("MarkWord: Retrieved user ID from context: %d", userId)
	if userId == 0 {
		logger.Errorf("MarkWord: No valid user id found in session context")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	word.Translate(userId)

	ud := enx.UserDict{}
	ud.WordId = word.Id
	ud.UserId = int(userId) // Convert int64 to int

	// Load current state first (this is crucial!)
	ud.IsExist()
	logger.Infof("MarkWord: Before marking - AlreadyAcquainted: %d", ud.AlreadyAcquainted)

	ud.Mark() // This will toggle the state

	// Use the state after marking (no need to query again)
	word.LoadCount = ud.QueryCount
	word.AlreadyAcquainted = ud.AlreadyAcquainted

	logger.Infof("MarkWord: Word marked, new state AlreadyAcquainted: %d", ud.AlreadyAcquainted)
	c.JSON(200, word)
}

func Ping(c *gin.Context) {
	c.JSON(200, gin.H{
		"message": "pong",
	})
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Success   bool      `json:"success"`
	Message   string    `json:"message"`
	User      *enx.User `json:"user,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, LoginResponse{
			Success: false,
			Message: "Invalid request parameters",
		})
		return
	}

	user := &enx.User{
		Name:     req.Username,
		Password: req.Password,
	}

	if user.Login() {
		// Create new session
		session, err := middleware.CreateSession(user.Id)
		if err != nil {
			logger.Errorf("failed to create session for user %s: %v", user.Name, err)
			c.JSON(http.StatusInternalServerError, LoginResponse{
				Success: false,
				Message: "Failed to create session",
			})
			return
		}

		// Set cookie - use empty domain for cross-origin requests
		c.SetCookie("session_id", session.ID, 24*3600, "/", "", false, true)

		logger.Infof("user login success, user: %+v", user)
		c.JSON(http.StatusOK, LoginResponse{
			Success:   true,
			Message:   "Login successful",
			User:      user,
			SessionID: session.ID,
		})
	} else {
		logger.Errorf("user login failed, user: %+v", user)
		c.JSON(http.StatusUnauthorized, LoginResponse{
			Success: false,
			Message: "Invalid username or password",
		})
	}
}

type LogRequest struct {
	Event     string `json:"event"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func LogHandler(c *gin.Context) {
	var req LogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid log request"})
		return
	}
	logger.Infof("[FE-LOG] event: %s, message: %s, timestamp: %s", req.Event, req.Message, req.Timestamp)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func Logout(c *gin.Context) {
	sessionID := c.GetHeader("X-Session-ID")
	if sessionID == "" {
		// Try to get from cookie
		cookie, err := c.Cookie("session_id")
		if err == nil {
			sessionID = cookie
		}
	}

	if sessionID != "" {
		if err := middleware.DeleteSession(sessionID); err != nil {
			logger.Errorf("failed to delete session: %v", err)
		}
	}

	// Clear cookie
	c.SetCookie("session_id", "", -1, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Logged out successfully",
	})
}

type RegisterRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
}

type RegisterResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Errorf("failed to bind register request: %+v", err)
		c.JSON(http.StatusBadRequest, RegisterResponse{
			Success: false,
			Message: "Invalid request parameters",
		})
		return
	}

	// Check if username already exists
	existingUser := enx.GeUserByName(req.Username)
	if existingUser.Id != 0 {
		c.JSON(http.StatusBadRequest, RegisterResponse{
			Success: false,
			Message: "Username already exists",
		})
		return
	}

	// Hash password
	hashedPassword, err := password.HashPassword(req.Password)
	if err != nil {
		logger.Errorf("failed to hash password for user %s: %v", req.Username, err)
		c.JSON(http.StatusInternalServerError, RegisterResponse{
			Success: false,
			Message: "Failed to process registration",
		})
		return
	}

	// Create new user
	user := &enx.User{
		Name:     req.Username,
		Password: hashedPassword,
		Email:    req.Email,
	}

	if err := user.Create(); err != nil {
		logger.Errorf("failed to create user %s: %v", req.Username, err)
		c.JSON(http.StatusInternalServerError, RegisterResponse{
			Success: false,
			Message: "Failed to create user",
		})
		return
	}

	logger.Infof("user registration success, user: %+v", user)
	c.JSON(http.StatusOK, RegisterResponse{
		Success: true,
		Message: "Registration successful",
	})
}
