package repository

import (
	"os"
	"testing"
	"time"

	"enx-data-service/internal/model"

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
