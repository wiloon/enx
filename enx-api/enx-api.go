package main

import (
	"context"
	"enx-api/email"
	"enx-api/enx"
	"enx-api/handlers"
	"enx-api/middleware"
	"enx-api/paragraph"
	"enx-api/translate"
	"enx-api/utils"
	"enx-api/utils/logger"
	"enx-api/utils/password"
	"enx-api/utils/sqlitex"
	wordCount "enx-api/word"
	"enx-api/youdao"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

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

	router := setupRouter()

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

func setupRouter() *gin.Engine {
	// ReleaseMode
	gin.SetMode(gin.DebugMode)
	router := gin.New()

	// Add Recovery middleware to recover from panics
	router.Use(gin.Recovery())

	// Add detailed CORS and request logging middleware BEFORE CORS
	router.Use(func(c *gin.Context) {
		logger.Debugf("🔵 [PRE-CORS] %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Debugf("📋 Origin='%s'", c.GetHeader("Origin"))

		c.Next()

		logger.Debugf("✅ [PRE-CORS] %d %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
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
		logger.Infof("🔵 %s %s from %s", c.Request.Method, c.Request.URL.Path, c.ClientIP())
		logger.Infof("📋 Headers: X-Session-ID='%s', Content-Type='%s', Origin='%s'",
			c.GetHeader("X-Session-ID"), c.GetHeader("Content-Type"), c.GetHeader("Origin"))
		logger.Debugf("🌐 User-Agent: %s", c.GetHeader("User-Agent"))

		// Check if this is a preflight request
		if c.Request.Method == "OPTIONS" {
			logger.Infof("✈️  CORS Preflight request")
		}

		c.Next()

		logger.Infof("✅ %d %s %s", c.Writer.Status(), c.Request.Method, c.Request.URL.Path)
		logger.Debugf("📤 Response Headers: %+v", c.Writer.Header())
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

	// APIs not requiring authentication (with /api prefix for Kong gateway)
	router.POST("/api/login", Login)
	router.POST("/api/logout", Logout)
	router.POST("/api/register", Register)
	router.GET("/api/verify-email", VerifyEmail)
	router.POST("/api/resend-verification", ResendVerification)
	router.POST("/api/forgot-password", ForgotPassword)
	router.POST("/api/reset-password", ResetPassword)

	// /api/me — requires authentication
	apiGroup.GET("/me", GetMe)

	// Temporary test route - no authentication required
	router.POST("/mark-test", MarkWord)

	return router
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
		// query from official Youdao API
		epc := youdao.QueryAPI(key)
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

	// query from official Youdao API
	epc := youdao.QueryAPI(key)
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
	logger.Debugf("%s", text)
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
	logger.Infof("MarkWord: Retrieved user ID from context: %s", userId)
	if userId == "" {
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
	ud.UserId = userId

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

// rateLimitStore tracks last-sent timestamps for email rate limiting (60s).
var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string]time.Time)
)

// checkRateLimit returns true if the email address is allowed (not rate-limited).
func checkRateLimit(email string) bool {
	rateLimitMu.Lock()
	defer rateLimitMu.Unlock()
	if last, ok := rateLimitStore[email]; ok {
		if time.Since(last) < 60*time.Second {
			return false
		}
	}
	rateLimitStore[email] = time.Now()
	return true
}

// GetMe returns the current user's public fields including status.
func GetMe(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":     user.Id,
		"name":   user.Name,
		"email":  user.Email,
		"status": user.Status,
	})
}

// VerifyEmail handles GET /api/verify-email?token=xxx
func VerifyEmail(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid activation link."})
		return
	}

	user := enx.GetUserByVerificationToken(token)
	if user.Id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid activation link."})
		return
	}

	if user.Status == "active" {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Account already activated."})
		return
	}

	if time.Now().After(user.TokenExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Activation link has expired. Please request a new one."})
		return
	}

	if err := user.Activate(); err != nil {
		logger.Errorf("failed to activate user %s: %v", user.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to activate account"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

type ResendVerificationRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ResendVerification handles POST /api/resend-verification
func ResendVerification(c *gin.Context) {
	var req ResendVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Always return success to prevent user enumeration
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	// Rate limiting
	if !checkRateLimit(req.Email) {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	user := enx.GetUserByEmail(req.Email)
	if user.Id == "" {
		// Always return success to prevent user enumeration
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	token, err := enx.GenerateToken()
	if err != nil {
		logger.Errorf("failed to generate verification token for %s: %v", req.Email, err)
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	if err := user.SetVerificationToken(token, time.Now().Add(48*time.Hour)); err != nil {
		logger.Errorf("failed to save verification token for %s: %v", req.Email, err)
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	if err := email.SendVerificationEmail(req.Email, user.Name, token); err != nil {
		logger.Errorf("failed to resend verification email to %s: %v", req.Email, err)
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ForgotPassword handles POST /api/forgot-password
func ForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	// Rate limiting
	if !checkRateLimit("reset:" + req.Email) {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	user := enx.GetUserByEmail(req.Email)
	if user.Id == "" {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	token, err := enx.GenerateToken()
	if err != nil {
		logger.Errorf("failed to generate reset token for %s: %v", req.Email, err)
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	if err := user.SetResetToken(token, time.Now().Add(time.Hour)); err != nil {
		logger.Errorf("failed to save reset token for %s: %v", req.Email, err)
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}

	if err := email.SendPasswordResetEmail(req.Email, user.Name, token); err != nil {
		logger.Errorf("failed to send reset email to %s: %v", req.Email, err)
	}

	response := gin.H{"success": true}
	if user.Status == "pending" {
		response["warning"] = "Your email address has not been verified. The reset email may not be delivered if the address is incorrect."
	}
	c.JSON(http.StatusOK, response)
}

type ResetPasswordRequest struct {
	Token    string `json:"token" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
}

// ResetPassword handles POST /api/reset-password
func ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid request parameters"})
		return
	}

	user := enx.GetUserByResetToken(req.Token)
	if user.Id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid reset link."})
		return
	}

	if time.Now().After(user.ResetTokenExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Reset link has expired. Please request a new one."})
		return
	}

	if err := user.UpdatePassword(req.Password); err != nil {
		logger.Errorf("failed to update password for user %s: %v", user.Id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to update password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
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
	Status    string    `json:"status,omitempty"`
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
			Status:    user.Status,
		})
	} else {
		logger.Errorf("user login failed, username: %s", req.Username)
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "invalid_credentials",
			"message": "Invalid username or password",
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
	Success   bool      `json:"success"`
	Message   string    `json:"message"`
	User      *enx.User `json:"user,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
	Status    string    `json:"status,omitempty"`
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
	if existingUser.Id != "" {
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

	// Create new user with pending status and verification token
	verifyToken, err := enx.GenerateToken()
	if err != nil {
		logger.Errorf("failed to generate verification token: %v", err)
		c.JSON(http.StatusInternalServerError, RegisterResponse{
			Success: false,
			Message: "Failed to process registration",
		})
		return
	}

	user := &enx.User{
		Name:              req.Username,
		Password:          hashedPassword,
		Email:             req.Email,
		Status:            "pending",
		VerificationToken: verifyToken,
		TokenExpiresAt:    time.Now().Add(48 * time.Hour),
	}

	if err := user.Create(); err != nil {
		logger.Errorf("failed to create user %s: %v", req.Username, err)
		c.JSON(http.StatusInternalServerError, RegisterResponse{
			Success: false,
			Message: "Failed to create user",
		})
		return
	}

	// Send verification email; failure is non-fatal
	if err := email.SendVerificationEmail(req.Email, req.Username, verifyToken); err != nil {
		logger.Errorf("failed to send verification email to %s: %v", req.Email, err)
	}

	// Auto-login: create session immediately
	session, err := middleware.CreateSession(user.Id)
	if err != nil {
		logger.Errorf("failed to create session after registration for user %s: %v", user.Name, err)
		// Registration succeeded, just skip auto-login
		logger.Infof("user registration success (no session), user: %+v", user)
		c.JSON(http.StatusOK, RegisterResponse{
			Success: true,
			Message: "Registration successful. Please check your email to verify your account.",
			Status:  "pending",
		})
		return
	}

	c.SetCookie("session_id", session.ID, 24*3600, "/", "", false, true)

	logger.Infof("user registration success, user: %+v", user)
	c.JSON(http.StatusOK, RegisterResponse{
		Success:   true,
		Message:   "Registration successful. Please check your email to verify your account.",
		User:      user,
		SessionID: session.ID,
		Status:    "pending",
	})
}
