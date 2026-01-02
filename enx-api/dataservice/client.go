package dataservice

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	pb "enx-api/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Client wraps the gRPC client for data-service
type Client struct {
	conn   *grpc.ClientConn
	client pb.DataServiceClient
	addr   string
}

// NewClient creates a new data-service client
func NewClient(addr string) (*Client, error) {
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithTimeout(5*time.Second))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to data-service: %w", err)
	}

	client := pb.NewDataServiceClient(conn)

	return &Client{
		conn:   conn,
		client: client,
		addr:   addr,
	}, nil
}

// Close closes the gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// GetWordByEnglish gets a word by English text (case insensitive)
func (c *Client) GetWordByEnglish(ctx context.Context, english string) (*pb.Word, error) {
	// Use ListWords and filter client-side
	// TODO: Add GetWordByEnglish RPC to data-service for efficiency
	resp, err := c.client.ListWords(ctx, &pb.ListWordsRequest{
		Limit:  1000, // Reasonable limit for filtering
		Offset: 0,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list words: %w", err)
	}

	// Filter by english (case insensitive)
	englishLower := strings.ToLower(english)
	for _, word := range resp.Words {
		if strings.ToLower(word.English) == englishLower {
			return word, nil
		}
	}

	return nil, fmt.Errorf("word not found: %s", english)
}

// SearchWords searches for words by prefix
func (c *Client) SearchWords(ctx context.Context, prefix string, limit int32) ([]*pb.Word, error) {
	// TODO: Add SearchWords RPC to data-service for server-side filtering
	// For now, list all and filter client-side
	resp, err := c.client.ListWords(ctx, &pb.ListWordsRequest{
		Limit:  limit * 2, // Get more than needed for filtering
		Offset: 0,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list words: %w", err)
	}

	// Filter by prefix (case insensitive)
	var results []*pb.Word
	prefixLower := strings.ToLower(prefix)
	for _, word := range resp.Words {
		wordLower := strings.ToLower(word.English)
		if len(wordLower) >= len(prefixLower) && wordLower[:len(prefixLower)] == prefixLower {
			results = append(results, word)
			if len(results) >= int(limit) {
				break
			}
		}
	}

	return results, nil
}

// GetWordByID gets a word by ID
func (c *Client) GetWordByID(ctx context.Context, id string) (*pb.Word, error) {
	resp, err := c.client.GetWord(ctx, &pb.GetWordRequest{
		Id: id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get word: %w", err)
	}

	return resp.Word, nil
}

// CreateWord creates a new word
func (c *Client) CreateWord(ctx context.Context, english, chinese, pronunciation string) (*pb.Word, error) {
	resp, err := c.client.CreateWord(ctx, &pb.CreateWordRequest{
		English:       english,
		Chinese:       chinese,
		Pronunciation: pronunciation,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create word: %w", err)
	}

	return resp.Word, nil
}

// UpdateWord updates an existing word
func (c *Client) UpdateWord(ctx context.Context, word *pb.Word) (*pb.Word, error) {
	resp, err := c.client.UpdateWord(ctx, &pb.UpdateWordRequest{
		Word: word,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update word: %w", err)
	}

	return resp.Word, nil
}

// DeleteWord soft deletes a word
func (c *Client) DeleteWord(ctx context.Context, id string) error {
	_, err := c.client.DeleteWord(ctx, &pb.DeleteWordRequest{
		Id: id,
	})
	if err != nil {
		return fmt.Errorf("failed to delete word: %w", err)
	}

	return nil
}

// ListWords lists words with pagination
func (c *Client) ListWords(ctx context.Context, limit, offset int32) ([]*pb.Word, int32, error) {
	resp, err := c.client.ListWords(ctx, &pb.ListWordsRequest{
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list words: %w", err)
	}

	return resp.Words, resp.Total, nil
}

// Global client instance
var globalClient *Client

// InitGlobalClient initializes the global data-service client
func InitGlobalClient(addr string) error {
	client, err := NewClient(addr)
	if err != nil {
		return err
	}

	globalClient = client
	log.Printf("✅ Connected to data-service at %s", addr)
	return nil
}

// GetGlobalClient returns the global client instance
func GetGlobalClient() *Client {
	if globalClient == nil {
		log.Fatal("❌ Data-service client not initialized. Call InitGlobalClient first.")
	}
	return globalClient
}

// GetUserDict retrieves user dictionary entry
func (c *Client) GetUserDict(ctx context.Context, req *pb.GetUserDictRequest) (*pb.GetUserDictResponse, error) {
	return c.client.GetUserDict(ctx, req)
}

// UpsertUserDict creates or updates user dictionary entry
func (c *Client) UpsertUserDict(ctx context.Context, req *pb.UpsertUserDictRequest) (*pb.UpsertUserDictResponse, error) {
	return c.client.UpsertUserDict(ctx, req)
}
