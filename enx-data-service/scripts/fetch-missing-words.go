package main

import (
	"context"
	"fmt"
	"log"
	"time"

	pb "enx-data-service/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	remoteAddr := "192.168.50.190:50051"
	missingIDs := []string{
		"e13a2956-e6ab-453d-b8df-21bd298ec0c2",
		"65e9d915-aecd-420d-ba0a-3a81ec0a06f6",
		"ad1c50f0-6659-4816-9994-fbf37b4245aa",
		"11fb1439-532d-483c-bb12-cd4ab16b1aef",
		"ddbadafb-4a93-412f-a5b5-5a193049fdfb",
		"16771412-7af1-4ae4-a30e-2251bb93ca76",
		"9ccc549a-c9a1-4242-a205-b7ae200abfeb",
		"bd8a38ad-ec06-4289-bcae-98931f4ef8eb",
		"f0464c12-3e89-4c1b-a6b7-47898552c465",
	}

	fmt.Println("🔍 Fetching details of missing words from remote...")
	fmt.Println()

	conn, err := grpc.NewClient(remoteAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	client := pb.NewDataServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	stream, err := client.SyncWords(ctx, &pb.SyncWordsRequest{
		SinceTimestamp: 0,
	})
	if err != nil {
		log.Fatalf("Failed to start sync: %v", err)
	}

	// Collect all words and filter the missing ones
	missingMap := make(map[string]bool)
	for _, id := range missingIDs {
		missingMap[id] = true
	}

	fmt.Printf("%-38s %-30s %-20s %-20s\n", "ID", "English", "UpdatedAt", "CreatedAt")
	fmt.Println("--------------------------------------------------------------------------------------------------------------------------")

	for {
		resp, err := stream.Recv()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			log.Fatalf("Stream error: %v", err)
		}

		if missingMap[resp.Word.Id] {
			fmt.Printf("%-38s %-30s %-20d %-20d\n",
				resp.Word.Id,
				resp.Word.English,
				resp.Word.UpdatedAt,
				resp.Word.CreatedAt,
			)
		}
	}

	fmt.Println()
	fmt.Println("✅ Complete")
}
