package sync

import (
	"context"
	"net"
	"os"
	"testing"
	"time"

	"enx-sync/internal/model"
	"enx-sync/internal/repository"
	"enx-sync/internal/service"
	pb "enx-sync/proto"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

func setupTestNodes(t *testing.T) (*Coordinator, *Coordinator, string, string, func()) {
	dbPath1 := "/tmp/test_node1_" + uuid.New().String() + ".db"
	dbPath2 := "/tmp/test_node2_" + uuid.New().String() + ".db"

	repo1, err := repository.NewWordRepository(dbPath1)
	require.NoError(t, err)

	repo2, err := repository.NewWordRepository(dbPath2)
	require.NoError(t, err)

	// Start gRPC server for node 1
	lis1, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err)
	node1Addr := lis1.Addr().String()

	server1 := grpc.NewServer()
	wordService1 := service.NewWordService(repo1)
	pb.RegisterDataServiceServer(server1, wordService1)
	go server1.Serve(lis1)

	// Start gRPC server for node 2
	lis2, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err)
	node2Addr := lis2.Addr().String()

	server2 := grpc.NewServer()
	wordService2 := service.NewWordService(repo2)
	pb.RegisterDataServiceServer(server2, wordService2)
	go server2.Serve(lis2)

	coord1 := NewCoordinator(repo1, "node1")
	coord2 := NewCoordinator(repo2, "node2")

	cleanup := func() {
		server1.Stop()
		server2.Stop()
		repo1.Close()
		repo2.Close()
		os.Remove(dbPath1)
		os.Remove(dbPath2)
	}

	return coord1, coord2, node1Addr, node2Addr, cleanup
}

func TestSyncWithPeer_InitialSync(t *testing.T) {
	coord1, coord2, node1Addr, _, cleanup := setupTestNodes(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	word1 := &model.Word{
		ID:        uuid.New().String(),
		English:   "hello",
		Chinese:   stringPtr("你好"),
		CreatedAt: now,
		UpdatedAt: now,
	}
	err := coord1.repo.Create(word1)
	require.NoError(t, err)

	// Node 2 syncs from Node 1 (pulls changes)
	err = coord2.SyncWithPeer(context.Background(), node1Addr)
	require.NoError(t, err)

	found, err := coord2.repo.FindByID(word1.ID)
	require.NoError(t, err)
	assert.Equal(t, "hello", found.English)
	assert.Equal(t, "你好", *found.Chinese)
}

func TestSyncWithPeer_ConflictResolution_RemoteNewer(t *testing.T) {
	coord1, coord2, _, node2Addr, cleanup := setupTestNodes(t)
	defer cleanup()

	wordID := uuid.New().String()
	oldTime := time.Now().UnixMilli()
	newTime := oldTime + 1000

	word1 := &model.Word{
		ID:        wordID,
		English:   "test",
		Chinese:   stringPtr("旧"),
		CreatedAt: oldTime,
		UpdatedAt: oldTime,
	}
	coord1.repo.Create(word1)

	word2 := &model.Word{
		ID:        wordID,
		English:   "test",
		Chinese:   stringPtr("新"),
		CreatedAt: oldTime,
		UpdatedAt: newTime,
	}
	coord2.repo.Create(word2)

	// Node 1 syncs from Node 2, should get newer version
	err := coord1.SyncWithPeer(context.Background(), node2Addr)
	require.NoError(t, err)

	found, err := coord1.repo.FindByID(wordID)
	require.NoError(t, err)
	assert.Equal(t, "新", *found.Chinese)
	assert.Equal(t, newTime, found.UpdatedAt)
}

func TestSyncWithPeer_ConflictResolution_LocalNewer(t *testing.T) {
	coord1, coord2, _, node2Addr, cleanup := setupTestNodes(t)
	defer cleanup()

	wordID := uuid.New().String()
	oldTime := time.Now().UnixMilli()
	newTime := oldTime + 1000

	word1 := &model.Word{
		ID:        wordID,
		English:   "test",
		Chinese:   stringPtr("新"),
		CreatedAt: oldTime,
		UpdatedAt: newTime,
	}
	coord1.repo.Create(word1)

	word2 := &model.Word{
		ID:        wordID,
		English:   "test",
		Chinese:   stringPtr("旧"),
		CreatedAt: oldTime,
		UpdatedAt: oldTime,
	}
	coord2.repo.Create(word2)

	// Node 1 syncs from Node 2, but local version is newer so should keep it
	err := coord1.SyncWithPeer(context.Background(), node2Addr)
	require.NoError(t, err)

	found, err := coord1.repo.FindByID(wordID)
	require.NoError(t, err)
	assert.Equal(t, "新", *found.Chinese)
	assert.Equal(t, newTime, found.UpdatedAt)
}

func stringPtr(s string) *string {
	return &s
}

// ==================== UserDict Sync Tests ====================

func TestSyncWithPeer_UserDict_InitialSync(t *testing.T) {
	coord1, coord2, node1Addr, _, cleanup := setupTestNodes(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	userDict1 := &model.UserDict{
		UserId:            "user-123",
		WordId:            uuid.New().String(),
		QueryCount:        5,
		AlreadyAcquainted: 1,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	err := coord1.repo.UpsertUserDict(userDict1)
	require.NoError(t, err)

	// Node 2 syncs from Node 1 (pulls user_dict changes)
	err = coord2.SyncWithPeer(context.Background(), node1Addr)
	require.NoError(t, err)

	found, err := coord2.repo.FindUserDict(userDict1.UserId, userDict1.WordId)
	require.NoError(t, err)
	assert.Equal(t, 5, found.QueryCount)
	assert.Equal(t, 1, found.AlreadyAcquainted)
}

func TestSyncWithPeer_UserDict_ConflictResolution_RemoteNewer(t *testing.T) {
	coord1, coord2, _, node2Addr, cleanup := setupTestNodes(t)
	defer cleanup()

	userId := "user-456"
	wordId := uuid.New().String()
	oldTime := time.Now().UnixMilli()
	newTime := oldTime + 1000

	// Node 1 has old version
	userDict1 := &model.UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        3,
		AlreadyAcquainted: 0,
		CreatedAt:         oldTime,
		UpdatedAt:         oldTime,
	}
	coord1.repo.UpsertUserDict(userDict1)

	// Node 2 has newer version
	userDict2 := &model.UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        10,
		AlreadyAcquainted: 1,
		CreatedAt:         oldTime,
		UpdatedAt:         newTime,
	}
	coord2.repo.UpsertUserDict(userDict2)

	// Node 1 syncs from Node 2, should get newer version
	err := coord1.SyncWithPeer(context.Background(), node2Addr)
	require.NoError(t, err)

	found, err := coord1.repo.FindUserDict(userId, wordId)
	require.NoError(t, err)
	assert.Equal(t, 10, found.QueryCount)
	assert.Equal(t, 1, found.AlreadyAcquainted)
	assert.Equal(t, newTime, found.UpdatedAt)
}

func TestSyncWithPeer_UserDict_ConflictResolution_LocalNewer(t *testing.T) {
	coord1, coord2, _, node2Addr, cleanup := setupTestNodes(t)
	defer cleanup()

	userId := "user-789"
	wordId := uuid.New().String()
	oldTime := time.Now().UnixMilli()
	newTime := oldTime + 1000

	// Node 1 has newer version
	userDict1 := &model.UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        15,
		AlreadyAcquainted: 1,
		CreatedAt:         oldTime,
		UpdatedAt:         newTime,
	}
	coord1.repo.UpsertUserDict(userDict1)

	// Node 2 has older version
	userDict2 := &model.UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        5,
		AlreadyAcquainted: 0,
		CreatedAt:         oldTime,
		UpdatedAt:         oldTime,
	}
	coord2.repo.UpsertUserDict(userDict2)

	// Node 1 syncs from Node 2, but local version is newer so should keep it
	err := coord1.SyncWithPeer(context.Background(), node2Addr)
	require.NoError(t, err)

	found, err := coord1.repo.FindUserDict(userId, wordId)
	require.NoError(t, err)
	assert.Equal(t, 15, found.QueryCount)
	assert.Equal(t, 1, found.AlreadyAcquainted)
	assert.Equal(t, newTime, found.UpdatedAt)
}

func TestSyncWithPeer_BothWordsAndUserDicts(t *testing.T) {
	coord1, coord2, node1Addr, _, cleanup := setupTestNodes(t)
	defer cleanup()

	now := time.Now().UnixMilli()

	// Create a word on Node 1
	word := &model.Word{
		ID:        uuid.New().String(),
		English:   "algorithm",
		Chinese:   stringPtr("算法"),
		CreatedAt: now,
		UpdatedAt: now,
	}
	err := coord1.repo.Create(word)
	require.NoError(t, err)

	// Create a user_dict on Node 1
	userDict := &model.UserDict{
		UserId:            "user-999",
		WordId:            word.ID,
		QueryCount:        7,
		AlreadyAcquainted: 1,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	err = coord1.repo.UpsertUserDict(userDict)
	require.NoError(t, err)

	// Node 2 syncs from Node 1 (should get both word and user_dict)
	err = coord2.SyncWithPeer(context.Background(), node1Addr)
	require.NoError(t, err)

	// Verify word was synced
	foundWord, err := coord2.repo.FindByID(word.ID)
	require.NoError(t, err)
	assert.Equal(t, "algorithm", foundWord.English)
	assert.Equal(t, "算法", *foundWord.Chinese)

	// Verify user_dict was synced
	foundUserDict, err := coord2.repo.FindUserDict(userDict.UserId, userDict.WordId)
	require.NoError(t, err)
	assert.Equal(t, 7, foundUserDict.QueryCount)
	assert.Equal(t, 1, foundUserDict.AlreadyAcquainted)
}
