package aitranslate

import (
	"context"
	"errors"
	"testing"

	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/wordcontext"
)

type chatReply struct {
	content string
	err     error
}

// replies is a chat that answers with seq in order, repeating the last one,
// and counts the requests. A reply that is not an error is billed 10 prompt
// + 5 completion tokens.
func replies(calls *int, seq ...chatReply) llm.Chat {
	return func(context.Context, string, float64, string, string) (string, Usage, error) {
		step := seq[min(*calls, len(seq)-1)]
		*calls++
		if step.err != nil {
			return "", Usage{}, step.err
		}
		return step.content, Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15}, nil
	}
}

func retryWordInContext(attempts int, chat llm.Chat) (wordcontext.Result, Usage, error) {
	return retryParse(context.Background(), attempts, chat, func(ctx context.Context, chat llm.Chat) (wordcontext.Result, Usage, error) {
		return wordcontext.Call(ctx, chat, "I deposited cash at the bank.", "bank", "")
	})
}

var (
	malformed  = chatReply{content: "not json at all"}
	wellFormed = chatReply{content: `{"word":"银行"}`}
	refused    = chatReply{err: errors.New("unauthorized")}
)

func TestRetriesOneMalformedReplyAndSumsUsage(t *testing.T) {
	var calls int

	res, u, err := retryWordInContext(2, replies(&calls, malformed, wellFormed))

	if err != nil || res.WordChinese != "银行" {
		t.Fatalf("got %+v, %v", res, err)
	}
	if calls != 2 {
		t.Fatalf("requests: got %d, want 2", calls)
	}
	if u != (Usage{PromptTokens: 20, CompletionTokens: 10, TotalTokens: 30}) {
		t.Fatalf("usage: got %+v", u)
	}
}

func TestGivesUpAfterTwoMalformedRepliesAndBillsBoth(t *testing.T) {
	var calls int

	_, u, err := retryWordInContext(2, replies(&calls, malformed))

	if err == nil {
		t.Fatal("want a parse error")
	}
	if calls != 2 {
		t.Fatalf("requests: got %d, want 2", calls)
	}
	if u.TotalTokens != 30 {
		t.Fatalf("usage: got %+v, want both attempts billed", u)
	}
}

func TestDoesNotRetryAFailedRequest(t *testing.T) {
	var calls int

	_, _, err := retryWordInContext(2, replies(&calls, refused))

	if !errors.Is(err, refused.err) {
		t.Fatalf("err = %v, want the chat's", err)
	}
	if calls != 1 {
		t.Fatalf("requests: got %d, want 1", calls)
	}
}

func TestAFailedRetryStillBillsTheFirstAttempt(t *testing.T) {
	var calls int

	_, u, err := retryWordInContext(2, replies(&calls, malformed, refused))

	if !errors.Is(err, refused.err) {
		t.Fatalf("err = %v, want the chat's", err)
	}
	if calls != 2 {
		t.Fatalf("requests: got %d, want 2", calls)
	}
	if u.TotalTokens != 15 {
		t.Fatalf("usage: got %+v, want the first attempt's 15", u)
	}
}

func TestOneAttemptDoesNotRetry(t *testing.T) {
	var calls int

	_, u, err := retryWordInContext(1, replies(&calls, malformed, wellFormed))

	if err == nil || calls != 1 || u.TotalTokens != 15 {
		t.Fatalf("calls = %d, usage = %+v, err = %v, want one billed failure", calls, u, err)
	}
}
