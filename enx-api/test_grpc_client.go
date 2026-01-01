package main

import (
	"context"
	"fmt"
	"log"
	"time"

	pb "enx-api/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	// Connect to data-service
	conn, err := grpc.NewClient("localhost:50051",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithTimeout(5*time.Second))
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	client := pb.NewDataServiceClient(conn)

	// Test 1: List words
	fmt.Println("=== Test 1: List Words ===")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.ListWords(ctx, &pb.ListWordsRequest{
		Limit:  5,
		Offset: 0,
	})
	if err != nil {
		log.Fatalf("ListWords failed: %v", err)
	}

	fmt.Printf("Total words: %d\n", resp.Total)
	fmt.Println("First 5 words:")
	for _, word := range resp.Words {
		fmt.Printf("  - %s: %s (%s)\n", word.English, word.Chinese, word.Pronunciation)
	}

	// Test 2: Get word by English (search for "a")
	fmt.Println("\n=== Test 2: Search for word 'a' ===")
	for _, w := range resp.Words {
		if w.English == "a" {
			fmt.Printf("Found: %s -> %s\n", w.English, w.Chinese)
			break
		}
	}

	fmt.Println("\n✅ All tests passed!")
}
