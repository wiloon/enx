package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"enx-api/ecdict"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Admin dictionary maintenance (ADR-021).
//
// These handlers are independent of the user lookup path
// (translate.Handler.TranslateByWord): no metering, no words/ECDICT
// merge-or-short-circuit, no ECDICT backfill, no user_dicts review counting.
// They return each table's raw row so an admin can compare `words` against
// ECDICT and, if wanted, copy ECDICT's data onto the `words` row. Gated by
// middleware.RequireAdmin on the route.

// adminWordRow is a words-table row for the maintenance page -- every column,
// tombstones (deleted_at) included.
type adminWordRow struct {
	Found         bool   `json:"found"`
	Id            string `json:"id,omitempty"`
	English       string `json:"english,omitempty"`
	Chinese       string `json:"chinese,omitempty"`
	Pronunciation string `json:"pronunciation,omitempty"`
	LoadCount     int    `json:"loadCount,omitempty"`
	CreatedAt     int64  `json:"createdAt,omitempty"`
	UpdatedAt     int64  `json:"updatedAt,omitempty"`
	DeletedAt     *int64 `json:"deletedAt,omitempty"`
	// Source is where the definition first came from ("ecdict" or "ai");
	// AdminEditedAt is when an admin last edited it, absent if none has
	// (ADR-045 Decision 6).
	Source        string `json:"source,omitempty"`
	AdminEditedAt *int64 `json:"adminEditedAt,omitempty"`
	// For an AI-made row: the model's own 0-10 confidence and the prompt
	// version that produced it.
	AIQuality       *int    `json:"aiQuality,omitempty"`
	AIPromptVersion *string `json:"aiPromptVersion,omitempty"`
	// How many users have the word in their vocabulary and how many lookups
	// they made of it. Filled by AdminGetWord only. (loadCount above is not
	// maintained and is always 0.)
	Users   int64 `json:"users,omitempty"`
	Lookups int64 `json:"lookups,omitempty"`
}

func adminWordRowFrom(w *repo.Word) adminWordRow {
	return adminWordRow{
		Found:           true,
		Id:              w.Id,
		English:         w.English,
		Chinese:         w.Chinese,
		Pronunciation:   w.Pronunciation,
		LoadCount:       w.LoadCount,
		CreatedAt:       w.CreatedAt,
		UpdatedAt:       w.UpdatedAt,
		DeletedAt:       w.DeletedAt,
		Source:          w.Source,
		AdminEditedAt:   w.AdminEditedAt,
		AIQuality:       w.AIQuality,
		AIPromptVersion: w.AIPromptVersion,
	}
}

// adminEcdictRow is the matched ECDICT stardict row plus which fallback
// strategy hit ("exact" / "lower" / "sw" / "exchange").
type adminEcdictRow struct {
	Found       bool   `json:"found"`
	MatchedBy   string `json:"matchedBy,omitempty"`
	Word        string `json:"word,omitempty"`
	Sw          string `json:"sw,omitempty"`
	Phonetic    string `json:"phonetic,omitempty"`
	Translation string `json:"translation,omitempty"`
	Exchange    string `json:"exchange,omitempty"`
}

// AdminGetWord handles GET /api/admin/words/:word.
func AdminGetWord(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	row, found := repo.AdminGetWord(word)
	if !found {
		c.JSON(http.StatusOK, adminWordRow{Found: false})
		return
	}
	out := adminWordRowFrom(row)
	if usage, err := repo.AdminWordUsage(row.Id); err != nil {
		logger.Warnf("AdminGetWord: usage of word=%q: %v", word, err)
	} else {
		out.Users, out.Lookups = usage.Users, usage.Lookups
	}
	c.JSON(http.StatusOK, out)
}

// AdminGetEcdict handles GET /api/admin/ecdict/:word.
func AdminGetEcdict(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	if !ecdict.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": ecdict.UnavailableMessage()})
		return
	}
	row, matchedBy, found := ecdict.LookupRaw(c.Request.Context(), word)
	if !found {
		c.JSON(http.StatusOK, adminEcdictRow{Found: false})
		return
	}
	c.JSON(http.StatusOK, adminEcdictRow{
		Found:       true,
		MatchedBy:   matchedBy,
		Word:        row.Word,
		Sw:          row.Sw,
		Phonetic:    row.Phonetic,
		Translation: row.Translation,
		Exchange:    row.Exchange,
	})
}

// AdminSyncWordFromEcdict handles POST /api/admin/words/:word/sync-from-ecdict:
// copy the matched ECDICT row's translation/phonetic onto the words-table row
// (creating it if absent). The words table is a global shared cache, so this
// affects every user's next lookup of this word.
func AdminSyncWordFromEcdict(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	if !ecdict.IsAvailable() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": ecdict.UnavailableMessage()})
		return
	}

	eRow, matchedBy, found := ecdict.LookupRaw(c.Request.Context(), word)
	if !found {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "no ECDICT entry to sync from"})
		return
	}

	before, _ := repo.AdminGetWord(word)
	after, err := repo.AdminSyncWordFromEcdict(word, eRow.Translation, eRow.Phonetic)
	if err != nil {
		logger.Errorf("AdminSyncWordFromEcdict: word=%q: %v", word, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to update word"})
		return
	}

	beforeChinese, beforePron := "", ""
	if before != nil {
		beforeChinese, beforePron = before.Chinese, before.Pronunciation
	}
	logger.Infof("admin AdminSyncWordFromEcdict: %s synced word=%q from ECDICT (matchedBy=%s): chinese %q -> %q, pronunciation %q -> %q",
		c.GetString("clerk_user_id"), word, matchedBy, beforeChinese, after.Chinese, beforePron, after.Pronunciation)

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"matchedBy": matchedBy,
		"word":      adminWordRowFrom(after),
	})
}

const (
	adminAIWordsDefaultLimit = 50
	adminAIWordsMaxLimit     = 200
)

// AdminListAIWords handles GET /api/admin/ai-words: the AI-made definitions
// waiting for an admin (reviewed=false, the default), or the ones an admin has
// already edited or approved (reviewed=true), busiest first. An unreviewed AI
// definition is visible only to users who can use AI (ADR-045 Decision 6), so
// this queue is the backlog of what the rest of the users cannot yet see.
func AdminListAIWords(c *gin.Context) {
	reviewed := c.Query("reviewed") == "true"
	limit := adminAIWordsDefaultLimit
	if raw := c.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > adminAIWordsMaxLimit {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit must be between 1 and 200"})
			return
		}
		limit = n
	}
	offset := 0
	if raw := c.Query("offset"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "offset must be 0 or more"})
			return
		}
		offset = n
	}

	rows, total, err := repo.AdminListAIWords(reviewed, limit, offset)
	if err != nil {
		logger.Errorf("AdminListAIWords: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to list AI definitions"})
		return
	}
	words := make([]adminWordRow, 0, len(rows))
	for i := range rows {
		row := adminWordRowFrom(&rows[i].Word)
		row.Users, row.Lookups = rows[i].Users, rows[i].Lookups
		words = append(words, row)
	}
	c.JSON(http.StatusOK, gin.H{"words": words, "total": total})
}

// Bounds on an admin's edit. ECDICT translations run long, so the Chinese
// limit is generous; it exists to stop a pasted document, not to shape
// definitions.
const (
	adminEditChineseMax       = 4000
	adminEditPronunciationMax = 100
)

type adminEditWordRequest struct {
	Chinese       string `json:"chinese"`
	Pronunciation string `json:"pronunciation"`
}

// AdminEditWord handles PUT /api/admin/words/:word: replace the live words
// row's chinese and pronunciation and record the edit (repo.AdminEditWord).
// An AI-made row an admin has edited is no longer hidden from users who can't
// use AI (ADR-045 Decision 6). The row must exist: creating one is what the
// ECDICT sync and the user lookup do.
func AdminEditWord(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	var req adminEditWordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "chinese and pronunciation are required"})
		return
	}
	req.Chinese = strings.TrimSpace(req.Chinese)
	req.Pronunciation = strings.TrimSpace(req.Pronunciation)
	if req.Chinese == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "chinese must not be empty"})
		return
	}
	if utf8.RuneCountInString(req.Chinese) > adminEditChineseMax || utf8.RuneCountInString(req.Pronunciation) > adminEditPronunciationMax {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "chinese or pronunciation is too long"})
		return
	}

	before, _ := repo.AdminGetWord(word)
	after, err := repo.AdminEditWord(word, req.Chinese, req.Pronunciation)
	switch {
	case errors.Is(err, repo.ErrWordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "word not found"})
		return
	case err != nil:
		logger.Errorf("AdminEditWord: word=%q: %v", word, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to update word"})
		return
	}

	logger.Infof("admin AdminEditWord: %s edited word=%q (source=%s): chinese %q -> %q, pronunciation %q -> %q",
		c.GetString("clerk_user_id"), word, after.Source, before.Chinese, after.Chinese, before.Pronunciation, after.Pronunciation)

	c.JSON(http.StatusOK, gin.H{"success": true, "word": adminWordRowFrom(after)})
}

// AdminDeleteWord handles DELETE /api/admin/words/:word: remove the words row
// and every user's review row for it (repo.AdminDeleteWord). Admin-only
// because the words table is shared -- it used to be DELETE /api/word/:word,
// open to any signed-in user.
func AdminDeleteWord(c *gin.Context) {
	word := strings.TrimSpace(c.Param("word"))
	if word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "word is required"})
		return
	}
	deleted, err := repo.AdminDeleteWord(word)
	if err != nil {
		logger.Errorf("AdminDeleteWord: word=%q: %v", word, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to delete word"})
		return
	}
	logger.Infof("admin AdminDeleteWord: %s deleted word=%q (existed=%v)", c.GetString("clerk_user_id"), word, deleted)
	c.JSON(http.StatusOK, gin.H{"success": true, "deleted": deleted})
}
