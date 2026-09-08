package main

import (
	"net/http"
	"strings"

	"enx-api/ecdict"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Admin dictionary maintenance (ADR-021). These handlers are independent of
// the user lookup path (translate.TranslateByWord / translateWord): no
// metering, no words/ECDICT merge-or-short-circuit, no ECDICT backfill, no
// user_dicts review counting. They return each table's raw row so an admin
// can compare `words` against ECDICT and, if wanted, copy ECDICT's data onto
// the `words` row. Gated by middleware.RequireAdmin on the route.

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
}

func adminWordRowFrom(w *repo.Word) adminWordRow {
	return adminWordRow{
		Found:         true,
		Id:            w.Id,
		English:       w.English,
		Chinese:       w.Chinese,
		Pronunciation: w.Pronunciation,
		LoadCount:     w.LoadCount,
		CreatedAt:     w.CreatedAt,
		UpdatedAt:     w.UpdatedAt,
		DeletedAt:     w.DeletedAt,
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
	c.JSON(http.StatusOK, adminWordRowFrom(row))
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
