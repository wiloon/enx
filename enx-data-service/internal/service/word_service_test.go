package service

import (
	"context"
	"os"
	"testing"
	"time"

	"enx-data-service/internal/repository"
	pb "enx-data-service/proto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestService(t *testing.T) (*WordService, func()) {
	dbPath := "/tmp/test_service_" + uuid.New().String() + ".db"
	repo, err := repository.NewWordRepository(dbPath)
	require.NoError(t, err)

	service := NewWordService(repo)
	cleanup := func() {
		repo.Close()
		os.Remove(dbPath)
	}
	return service, cleanup
}

func TestCreateWord(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	resp, err := svc.CreateWord(context.Background(), &pb.CreateWordRequest{
		English: "test",
		Chinese: "测试",
	})

	require.NoError(t, err)
	assert.NotEmpty(t, resp.Word.Id)
	assert.Equal(t, "test", resp.Word.English)
	assert.Equal(t, "测试", resp.Word.Chinese)
}

func TestGetWord(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	ctx := context.Background()
	created, _ := svc.CreateWord(ctx, &pb.CreateWordRequest{English: "find"})

	found, err := svc.GetWord(ctx, &pb.GetWordRequest{Id: created.Word.Id})
	require.NoError(t, err)
	assert.Equal(t, "find", found.Word.English)
}

func TestUpdateWord(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	ctx := context.Background()
	created, _ := svc.CreateWord(ctx, &pb.CreateWordRequest{English: "old"})

	time.Sleep(10 * time.Millisecond)
	updated, err := svc.UpdateWord(ctx, &pb.UpdateWordRequest{
		Word: &pb.Word{
			Id:      created.Word.Id,
			Chinese: "新",
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "新", updated.Word.Chinese)
	assert.Greater(t, updated.Word.UpdatedAt, created.Word.UpdatedAt)
}

func TestDeleteWord(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	ctx := context.Background()
	created, _ := svc.CreateWord(ctx, &pb.CreateWordRequest{English: "del"})

	resp, err := svc.DeleteWord(ctx, &pb.DeleteWordRequest{Id: created.Word.Id})
	require.NoError(t, err)
	assert.Equal(t, created.Word.Id, resp.Id)

	found, _ := svc.GetWord(ctx, &pb.GetWordRequest{Id: created.Word.Id})
	assert.Greater(t, found.Word.DeletedAt, int64(0))
}

func TestListWords(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	ctx := context.Background()
	for _, en := range []string{"a", "b", "c"} {
		svc.CreateWord(ctx, &pb.CreateWordRequest{English: en})
	}

	resp, err := svc.ListWords(ctx, &pb.ListWordsRequest{})
	require.NoError(t, err)
	assert.Len(t, resp.Words, 3)
}

func TestSyncWords(t *testing.T) {
	svc, cleanup := setupTestService(t)
	defer cleanup()

	ctx := context.Background()

	// Create 2 old words
	svc.CreateWord(ctx, &pb.CreateWordRequest{English: "old1"})
	svc.CreateWord(ctx, &pb.CreateWordRequest{English: "old2"})

	// Record cutoff time
	cutoff := time.Now().UnixMilli()
	time.Sleep(10 * time.Millisecond)

	// Create 2 new words
	svc.CreateWord(ctx, &pb.CreateWordRequest{English: "new1"})
	svc.CreateWord(ctx, &pb.CreateWordRequest{English: "new2"})

	// Mock stream
	stream := &mockSyncStream{words: []*pb.Word{}}

	// Sync words modified since cutoff
	err := svc.SyncWords(&pb.SyncWordsRequest{SinceTimestamp: cutoff}, stream)
	require.NoError(t, err)

	// Should only return 2 new words
	assert.Len(t, stream.words, 2)
	englishWords := []string{stream.words[0].English, stream.words[1].English}
	assert.Contains(t, englishWords, "new1")
	assert.Contains(t, englishWords, "new2")
}

// Mock stream for testing
type mockSyncStream struct {
	pb.DataService_SyncWordsServer
	words []*pb.Word
}

func (m *mockSyncStream) Send(resp *pb.SyncWordsResponse) error {
	m.words = append(m.words, resp.Word)
	return nil
}

func (m *mockSyncStream) Context() context.Context {
	return context.Background()
}
