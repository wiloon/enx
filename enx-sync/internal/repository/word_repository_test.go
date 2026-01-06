package repository

import (
	"os"
	"testing"
	"time"

	"enx-sync/internal/model"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTestDB(t *testing.T) (*WordRepository, func()) {
	dbPath := "/tmp/test_enx_" + uuid.New().String() + ".db"
	repo, err := NewWordRepository(dbPath)
	require.NoError(t, err)

	cleanup := func() {
		repo.Close()
		os.Remove(dbPath)
	}
	return repo, cleanup
}

func TestCreate(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	chinese := "测试"
	word := &model.Word{
		ID:        uuid.New().String(),
		English:   "test",
		Chinese:   &chinese,
		CreatedAt: now,
		UpdatedAt: now,
	}

	err := repo.Create(word)
	assert.NoError(t, err)

	found, err := repo.FindByID(word.ID)
	require.NoError(t, err)
	assert.Equal(t, "test", found.English)
	assert.NotNil(t, found.Chinese)
	assert.Equal(t, "测试", *found.Chinese)
}

func TestUpdate(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	word := &model.Word{
		ID:        uuid.New().String(),
		English:   "original",
		CreatedAt: now,
		UpdatedAt: now,
	}
	repo.Create(word)

	updated := "更新"
	word.Chinese = &updated
	word.UpdatedAt = time.Now().UnixMilli()
	err := repo.Update(word)
	assert.NoError(t, err)

	found, err := repo.FindByID(word.ID)
	require.NoError(t, err)
	assert.NotNil(t, found.Chinese)
	assert.Equal(t, "更新", *found.Chinese)
}

func TestSoftDelete(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	word := &model.Word{
		ID:        uuid.New().String(),
		English:   "delete",
		CreatedAt: now,
		UpdatedAt: now,
	}
	repo.Create(word)

	err := repo.SoftDelete(word.ID, time.Now().UnixMilli())
	assert.NoError(t, err)

	found, err := repo.FindByID(word.ID)
	require.NoError(t, err)
	assert.NotNil(t, found.DeletedAt)
}

func TestFindAll(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	for _, en := range []string{"a", "b", "c"} {
		repo.Create(&model.Word{
			ID:        uuid.New().String(),
			English:   en,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	words, err := repo.FindAll()
	require.NoError(t, err)
	assert.Len(t, words, 3)
}

// ==================== UserDict Tests ====================

func TestUserDict_UpsertAndFind(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	userDict := &model.UserDict{
		UserId:            "user-123",
		WordId:            uuid.New().String(),
		QueryCount:        5,
		AlreadyAcquainted: 1,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	err := repo.UpsertUserDict(userDict)
	assert.NoError(t, err)

	found, err := repo.FindUserDict(userDict.UserId, userDict.WordId)
	require.NoError(t, err)
	assert.Equal(t, "user-123", found.UserId)
	assert.Equal(t, 5, found.QueryCount)
	assert.Equal(t, 1, found.AlreadyAcquainted)
}

func TestUserDict_Upsert_Update(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	userId := "user-456"
	wordId := uuid.New().String()

	// Insert initial record
	userDict := &model.UserDict{
		UserId:            userId,
		WordId:            wordId,
		QueryCount:        3,
		AlreadyAcquainted: 0,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	repo.UpsertUserDict(userDict)

	// Update the same record
	laterTime := now + 1000
	userDict.QueryCount = 10
	userDict.AlreadyAcquainted = 1
	userDict.UpdatedAt = laterTime

	err := repo.UpsertUserDict(userDict)
	assert.NoError(t, err)

	found, err := repo.FindUserDict(userId, wordId)
	require.NoError(t, err)
	assert.Equal(t, 10, found.QueryCount)
	assert.Equal(t, 1, found.AlreadyAcquainted)
	assert.Equal(t, laterTime, found.UpdatedAt)
}

func TestUserDict_FindModifiedSince(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	baseTime := time.Now().UnixMilli()

	// Create 3 user_dicts with different timestamps
	userDicts := []*model.UserDict{
		{
			UserId:            "user-1",
			WordId:            uuid.New().String(),
			QueryCount:        1,
			AlreadyAcquainted: 0,
			CreatedAt:         baseTime,
			UpdatedAt:         baseTime,
		},
		{
			UserId:            "user-2",
			WordId:            uuid.New().String(),
			QueryCount:        2,
			AlreadyAcquainted: 1,
			CreatedAt:         baseTime,
			UpdatedAt:         baseTime + 1000,
		},
		{
			UserId:            "user-3",
			WordId:            uuid.New().String(),
			QueryCount:        3,
			AlreadyAcquainted: 1,
			CreatedAt:         baseTime,
			UpdatedAt:         baseTime + 2000,
		},
	}

	for _, ud := range userDicts {
		repo.UpsertUserDict(ud)
	}

	// Query for records modified after baseTime + 500
	found, err := repo.FindUserDictsModifiedSince(baseTime + 500)
	require.NoError(t, err)
	assert.Len(t, found, 2) // Should find user-2 and user-3

	// Verify they are returned in descending order (newest first)
	assert.Equal(t, "user-3", found[0].UserId)
	assert.Equal(t, "user-2", found[1].UserId)
}

func TestUserDict_MultipleUsersOneWord(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	wordId := uuid.New().String()

	// Create user_dicts for 3 different users with same word
	for i, userId := range []string{"user-A", "user-B", "user-C"} {
		userDict := &model.UserDict{
			UserId:            userId,
			WordId:            wordId,
			QueryCount:        i + 1,
			AlreadyAcquainted: i % 2,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		err := repo.UpsertUserDict(userDict)
		require.NoError(t, err)
	}

	// Verify each user has their own record
	for i, userId := range []string{"user-A", "user-B", "user-C"} {
		found, err := repo.FindUserDict(userId, wordId)
		require.NoError(t, err)
		assert.Equal(t, i+1, found.QueryCount)
		assert.Equal(t, i%2, found.AlreadyAcquainted)
	}
}
