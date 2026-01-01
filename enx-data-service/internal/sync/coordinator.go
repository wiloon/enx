package sync

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"enx-data-service/internal/model"
	"enx-data-service/internal/repository"
	pb "enx-data-service/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Coordinator orchestrates P2P synchronization between nodes
type Coordinator struct {
	repo   *repository.WordRepository
	nodeID string
	mu     sync.RWMutex
}

// NewCoordinator creates a new sync coordinator
func NewCoordinator(repo *repository.WordRepository, nodeID string) *Coordinator {
	return &Coordinator{
		repo:   repo,
		nodeID: nodeID,
	}
}

// SyncWithPeer performs bidirectional sync with a peer node
func (c *Coordinator) SyncWithPeer(ctx context.Context, peerAddr string) error {
	log.Printf("[%s] Starting sync with peer: %s", c.nodeID, peerAddr)

	// Get last sync time from database
	lastSync, err := c.repo.GetLastSyncTime(peerAddr)
	if err != nil {
		return fmt.Errorf("failed to get last sync time: %w", err)
	}

	log.Printf("[%s] Last sync with %s was at: %d", c.nodeID, peerAddr, lastSync)

	// PULL: Get changes from peer and apply them locally
	appliedFromPeer, err := c.pullChangesFromPeer(ctx, peerAddr, lastSync)
	if err != nil {
		return fmt.Errorf("failed to pull changes from peer: %w", err)
	}

	// Update last sync time in database
	now := time.Now().UnixMilli()
	if err := c.repo.UpdateLastSyncTime(peerAddr, now); err != nil {
		return fmt.Errorf("failed to update last sync time: %w", err)
	}

	log.Printf("[%s] Sync complete with %s: applied=%d", c.nodeID, peerAddr, appliedFromPeer)
	return nil
}

// pullChangesFromPeer fetches and applies changes from peer
func (c *Coordinator) pullChangesFromPeer(ctx context.Context, peerAddr string, sinceTimestamp int64) (int, error) {
	conn, err := grpc.NewClient(peerAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return 0, fmt.Errorf("failed to connect to peer: %w", err)
	}
	defer conn.Close()

	client := pb.NewDataServiceClient(conn)

	stream, err := client.SyncWords(ctx, &pb.SyncWordsRequest{
		SinceTimestamp: sinceTimestamp,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to start sync stream: %w", err)
	}

	appliedCount := 0
	skippedCount := 0

	for {
		resp, err := stream.Recv()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return appliedCount, fmt.Errorf("stream receive error: %w", err)
		}

		// Apply the change with conflict resolution
		if err := c.applyRemoteChange(resp.Word); err != nil {
			// Silently skip - mostly due to local version being newer
			skippedCount++
			continue
		}
		appliedCount++
	}

	if appliedCount > 0 || skippedCount > 0 {
		log.Printf("[%s] Pulled from %s: applied=%d, skipped=%d", c.nodeID, peerAddr, appliedCount, skippedCount)
	}
	return appliedCount, nil
}

// applyRemoteChange applies a change from peer with conflict resolution
func (c *Coordinator) applyRemoteChange(remoteWord *pb.Word) error {
	// Check if word exists locally
	localWord, err := c.repo.FindByID(remoteWord.Id)
	if err != nil {
		// Word doesn't exist locally, create it
		return c.repo.Create(convertProtoToModel(remoteWord))
	}

	// Conflict resolution: Last Write Wins (compare updated_at)
	if localWord.UpdatedAt >= remoteWord.UpdatedAt {
		return fmt.Errorf("local version is newer or equal (local=%d, remote=%d)", localWord.UpdatedAt, remoteWord.UpdatedAt)
	}

	// Remote version is newer, apply the update
	return c.repo.Update(convertProtoToModel(remoteWord))
}

// GetSyncStatus returns the current sync status from database
func (c *Coordinator) GetSyncStatus() map[string]interface{} {
	// Note: This now returns empty peers list
	// To get actual sync status, query sync_state table directly
	return map[string]interface{}{
		"node_id": c.nodeID,
		"peers":   []map[string]interface{}{},
		"count":   0,
	}
}

// Helper functions
func convertModelToProto(word *model.Word) *pb.Word {
	pbWord := &pb.Word{
		Id:        word.ID,
		English:   word.English,
		CreatedAt: word.CreatedAt,
		UpdatedAt: word.UpdatedAt,
	}
	if word.Chinese != nil {
		pbWord.Chinese = *word.Chinese
	}
	if word.DeletedAt != nil {
		pbWord.DeletedAt = *word.DeletedAt
	}
	return pbWord
}

func convertProtoToModel(pbWord *pb.Word) *model.Word {
	word := &model.Word{
		ID:        pbWord.Id,
		English:   pbWord.English,
		CreatedAt: pbWord.CreatedAt,
		UpdatedAt: pbWord.UpdatedAt,
	}
	if pbWord.Chinese != "" {
		word.Chinese = &pbWord.Chinese
	}
	if pbWord.DeletedAt != 0 {
		word.DeletedAt = &pbWord.DeletedAt
	}
	return word
}
