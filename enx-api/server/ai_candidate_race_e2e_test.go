package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// gatedModel is a fake model whose chosen calls block until release, so a test
// decides how requests interleave. plan receives the 1-based call number and
// says what to reply and whether to hold the call.
type gatedModel struct {
	*httptest.Server
	calls   atomic.Int64
	arrived chan int64
	gate    chan struct{}
	once    sync.Once
}

func newGatedModel(t *testing.T, plan func(n int64) (reply string, hold bool)) *gatedModel {
	t.Helper()
	m := &gatedModel{arrived: make(chan int64, 8), gate: make(chan struct{})}
	m.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := m.calls.Add(1)
		reply, hold := plan(n)
		if hold {
			m.arrived <- n
			select {
			case <-m.gate:
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": reply}}},
			"usage":   map[string]any{"prompt_tokens": 150, "completion_tokens": 40, "total_tokens": 190},
		})
		_, _ = w.Write(body)
	}))
	t.Cleanup(func() { m.release(); m.Close() })
	return m
}

func (m *gatedModel) release() { m.once.Do(func() { close(m.gate) }) }

func (m *gatedModel) waitArrived(t *testing.T, aDone, bDone <-chan askResult) {
	t.Helper()
	select {
	case <-m.arrived:
	case r := <-aDone:
		t.Fatalf("A's request finished before the model call: %+v", r)
	case r := <-bDone:
		t.Fatalf("B's request finished before the model call: %+v", r)
	case <-time.After(10 * time.Second):
		t.Fatal("no call reached the model")
	}
}

type askResult struct {
	code int
	body map[string]any
	err  error
}

type raceEnv struct {
	base          string
	a, b          string // tokens of user A (credited) and user B (also the admin)
	model         *gatedModel
	askAsync      func(token string) <-chan askResult
	wordRows      func() int64
	candidateHits func() (hits int64, rows int64)
	aDone         <-chan askResult
}

// raceEnvWith boots the server on a gated model. User B is also the admin.
func raceEnvWith(t *testing.T, plan func(n int64) (string, bool)) *raceEnv {
	t.Helper()
	model := newGatedModel(t, plan)
	base, a, b, _ := aiWordEnvAt(t, model.URL)
	bUserID := signedInUserID(t, base, b, adminSub)
	if err := sqlitex.DB.Create(&sqlitex.CreditAccount{UserId: bUserID, TopupBalance: 30, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlitex.DB.Exec("DELETE FROM ai_candidates").Error; err != nil {
			t.Error(err)
		}
	})
	t.Cleanup(model.release)
	e := &raceEnv{base: base, a: a, b: b, model: model}
	e.askAsync = func(token string) <-chan askResult {
		ch := make(chan askResult, 1)
		go func() {
			code, body, err := requestJSONBody(http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": "rizzler"})
			ch <- askResult{code: code, body: body, err: err}
		}()
		return ch
	}
	e.wordRows = func() int64 {
		var n int64
		if err := sqlitex.DB.Raw("SELECT count(*) FROM words WHERE english = ? AND deleted_at IS NULL", "rizzler").Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	e.candidateHits = func() (int64, int64) {
		var rows []sqlitex.AICandidate
		if err := sqlitex.DB.Where("english = ?", "rizzler").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		if len(rows) == 0 {
			return 0, 0
		}
		return int64(rows[0].HitCount), int64(len(rows))
	}
	return e
}

func (e *raceEnv) await(t *testing.T, ch <-chan askResult) askResult {
	t.Helper()
	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatal(r.err)
		}
		return r
	case <-time.After(10 * time.Second):
		t.Fatal("request did not finish")
		return askResult{}
	}
}

const candidateDefinition = "n. 善于吸引他人的人"
const candidateReply = `{"is_word": true, "quality": 5, "senses": [{"pos": "n.", "zh": "善于吸引他人的人"}]}`

func (e *raceEnv) admin(t *testing.T, action string) (int, map[string]any) {
	t.Helper()
	return doJSON(t, http.MethodPost, e.base+"/api/admin/ai-candidates/rizzler/"+action, e.b)
}

// A's call (quality 9) is held; B's call (call 2, quality 5) answers at once
// and creates the candidate.
func holdAThenBCreatesTheCandidate(t *testing.T) *raceEnv {
	t.Helper()
	e := raceEnvWith(t, func(n int64) (string, bool) {
		if n == 1 {
			return confidentReply, true
		}
		return candidateReply, false
	})
	aDone := e.askAsync(e.a)
	e.model.waitArrived(t, aDone, nil)
	r := e.await(t, e.askAsync(e.b))
	word, _ := r.body["word"].(map[string]any)
	if r.code != http.StatusOK || r.body["found"] != true || word["Chinese"] != candidateDefinition {
		t.Fatalf("B's answer = %+v, want B's candidate definition", r)
	}
	if _, rows := e.candidateHits(); rows != 1 {
		t.Fatalf("candidate rows after B = %d, want 1", rows)
	}
	e.aDone = aDone
	return e
}

func TestE2E_AICandidateRace_RejectBeatsAQualifyingWrite(t *testing.T) {
	e := holdAThenBCreatesTheCandidate(t)
	if code, body := e.admin(t, "reject"); code != http.StatusOK {
		t.Fatalf("reject: code=%d body=%+v", code, body)
	}
	e.model.release()
	r := e.await(t, e.aDone)
	word, _ := r.body["word"].(map[string]any)
	if r.code != http.StatusOK || r.body["found"] != true || word["Chinese"] != "n. 很有魅力的人" || word["Id"] != "" {
		t.Fatalf("A's answer = %+v, want the definition with no id", r)
	}
	if n := e.wordRows(); n != 0 {
		t.Fatalf("words rows = %d, want none: the rejected word must not reach words", n)
	}
	calls := e.model.calls.Load()
	if r := e.await(t, e.askAsync(e.b)); r.code != http.StatusOK || r.body["found"] != false || r.body["reason"] != "no_definition" {
		t.Fatalf("later ask = %+v, want no_definition", r)
	}
	if got := e.model.calls.Load(); got != calls {
		t.Fatalf("a rejected hit called the provider: calls %d -> %d", calls, got)
	}
}

func TestE2E_AICandidateRace_AQualifyingWriteBeatsReject(t *testing.T) {
	e := holdAThenBCreatesTheCandidate(t)
	e.model.release()
	r := e.await(t, e.aDone)
	word, _ := r.body["word"].(map[string]any)
	persisted := persistedRizzler(t)
	id, _ := word["Id"].(string)
	if r.code != http.StatusOK || r.body["found"] != true || word["Chinese"] != "n. 很有魅力的人" || id != persisted.Id {
		t.Fatalf("A's answer = %+v, want A's definition with persisted ID %q", r, persisted.Id)
	}
	if code, _ := e.admin(t, "reject"); code != http.StatusNotFound {
		t.Fatalf("reject after A's write: code = %d, want 404", code)
	}
	if _, rows := e.candidateHits(); rows != 0 {
		t.Fatalf("candidate rows = %d, want the candidate gone", rows)
	}
	if code, body := doJSON(t, http.MethodGet, e.base+"/api/word/rizzler", e.a); code != http.StatusOK || body["Chinese"] != "n. 很有魅力的人" {
		t.Fatalf("lookup = %d %+v, want A's row", code, body)
	}
}

func TestE2E_AICandidateRace_ConcurrentMissesLeaveOneCandidate(t *testing.T) {
	e := raceEnvWith(t, func(int64) (string, bool) { return lowQualityReply, true })
	aDone := e.askAsync(e.a)
	bDone := e.askAsync(e.b)
	e.model.waitArrived(t, aDone, bDone)
	e.model.waitArrived(t, aDone, bDone)
	e.model.release()
	for name, ch := range map[string]<-chan askResult{"A": aDone, "B": bDone} {
		r := e.await(t, ch)
		word, _ := r.body["word"].(map[string]any)
		if r.code != http.StatusOK || r.body["found"] != true || word["Chinese"] != "n. 很有魅力的人" {
			t.Fatalf("%s's answer = %+v, want the definition", name, r)
		}
	}
	if hits, rows := e.candidateHits(); rows != 1 || hits != 2 {
		t.Fatalf("candidate rows = %d, hit count = %d, want 1 row with 2 hits", rows, hits)
	}
}

func TestE2E_AICandidateRace_ApproveBeatsAQualifyingWrite(t *testing.T) {
	e := holdAThenBCreatesTheCandidate(t)
	if code, body := e.admin(t, "approve"); code != http.StatusOK || body["created"] != true {
		t.Fatalf("approve: code=%d body=%+v", code, body)
	}
	approved := persistedRizzler(t)
	e.model.release()
	r := e.await(t, e.aDone)
	word, _ := r.body["word"].(map[string]any)
	id, _ := word["Id"].(string)
	if r.code != http.StatusOK || r.body["found"] != true || word["Chinese"] != "n. 很有魅力的人" || id != approved.Id {
		t.Fatalf("A's answer = %+v, want A's definition with B's approved ID %q", r, approved.Id)
	}
	if n := e.wordRows(); n != 1 {
		t.Fatalf("words rows = %d, want exactly 1", n)
	}
	persisted := persistedRizzler(t)
	if persisted.Id != approved.Id || persisted.Chinese == nil || *persisted.Chinese != candidateDefinition || persisted.AdminEditedAt == nil {
		t.Fatalf("persisted row = %+v, want B's reviewed definition with approved ID %q", persisted, approved.Id)
	}
}
