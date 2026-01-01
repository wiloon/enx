package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	pb "enx-data-service/proto"

	_ "github.com/mattn/go-sqlite3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	localDB := "/var/lib/enx-api/enx.db"
	remoteAddr := "192.168.50.190:50051"

	fmt.Println("🔍 Comparing databases via gRPC...")
	fmt.Println()

	// Get local IDs
	fmt.Println("Fetching local word IDs...")
	localIDs, err := getLocalIDs(localDB)
	if err != nil {
		log.Fatalf("Failed to get local IDs: %v", err)
	}
	fmt.Printf("Local: %d words\n", len(localIDs))

	// Get remote IDs via gRPC
	fmt.Printf("Fetching remote word IDs from %s...\n", remoteAddr)
	remoteIDs, err := getRemoteIDs(remoteAddr)
	if err != nil {
		log.Fatalf("Failed to get remote IDs: %v", err)
	}
	fmt.Printf("Remote: %d words\n", len(remoteIDs))

	fmt.Println()
	fmt.Println("📊 Differences:")
	fmt.Println()

	// Convert to maps for easier comparison
	localMap := make(map[string]bool)
	for _, id := range localIDs {
		localMap[id] = true
	}

	remoteMap := make(map[string]bool)
	for _, id := range remoteIDs {
		remoteMap[id] = true
	}

	// Find missing in local
	missingLocal := []string{}
	for id := range remoteMap {
		if !localMap[id] {
			missingLocal = append(missingLocal, id)
		}
	}

	// Find missing in remote
	missingRemote := []string{}
	for id := range localMap {
		if !remoteMap[id] {
			missingRemote = append(missingRemote, id)
		}
	}

	fmt.Printf("Words only in REMOTE (missing locally): %d\n", len(missingLocal))
	if len(missingLocal) > 0 && len(missingLocal) <= 20 {
		for _, id := range missingLocal {
			fmt.Printf("  - %s\n", id)
		}
	}

	fmt.Println()

	fmt.Printf("Words only in LOCAL (missing remotely): %d\n", len(missingRemote))
	if len(missingRemote) > 0 && len(missingRemote) <= 20 {
		db, _ := sql.Open("sqlite3", localDB)
		defer db.Close()
		for _, id := range missingRemote {
			var english string
			var updatedAt int64
			db.QueryRow("SELECT english, updated_at FROM words WHERE id = ?", id).Scan(&english, &updatedAt)
			fmt.Printf("  - %s: %s (updated: %d)\n", id, english, updatedAt)
		}
	}

	fmt.Println()
	fmt.Printf("✅ Comparison complete\n")
	fmt.Printf("Difference: %d records\n", len(remoteIDs)-len(localIDs))
}

func getLocalIDs(dbPath string) ([]string, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query("SELECT id FROM words ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, nil
}

func getRemoteIDs(addr string) ([]string, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	client := pb.NewDataServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Request all words since timestamp 0
	stream, err := client.SyncWords(ctx, &pb.SyncWordsRequest{
		SinceTimestamp: 0,
	})
	if err != nil {
		return nil, err
	}

	var ids []string
	for {
		resp, err := stream.Recv()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, err
		}
		ids = append(ids, resp.Word.Id)
	}

	return ids, nil
}
