package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"

	"enx-data-service/internal/api"
	"enx-data-service/internal/config"
	"enx-data-service/internal/repository"
	"enx-data-service/internal/service"
	"enx-data-service/internal/sync"
	pb "enx-data-service/proto"

	"google.golang.org/grpc"
)

const (
	defaultDBPath     = "/var/lib/enx-api/enx.db"
	defaultConfigPath = "config.yaml"
)

func main() {
	// Command line flags
	dbPath := flag.String("db", defaultDBPath, "Database file path")
	configPath := flag.String("config", defaultConfigPath, "Config file path")
	flag.Parse()

	log.Println("🚀 Starting ENX Data Service...")

	// Load configuration
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Printf("⚠️  Failed to load config: %v, using defaults", err)
		cfg = getDefaultConfig()
	}
	log.Printf("✅ Loaded configuration (node: %s)", cfg.Node.ID)

	// Initialize Repository
	repo, err := repository.NewWordRepository(*dbPath)
	if err != nil {
		log.Fatalf("❌ Failed to open database: %v", err)
	}
	defer repo.Close()
	log.Printf("✅ Connected to database: %s", *dbPath)

	// Initialize Sync Coordinator
	coordinator := sync.NewCoordinator(repo, cfg.Node.ID)
	log.Printf("✅ Sync coordinator initialized")

	// Start gRPC Server
	grpcAddr := fmt.Sprintf(":%d", cfg.Node.GRPCPort)
	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("❌ Failed to listen on %s: %v", grpcAddr, err)
	}

	grpcServer := grpc.NewServer()
	wordService := service.NewWordService(repo)
	pb.RegisterDataServiceServer(grpcServer, wordService)

	log.Printf("✅ gRPC server listening at %v", lis.Addr())

	// Start HTTP API Server
	httpAddr := fmt.Sprintf(":%d", cfg.Node.HTTPPort)
	httpServer := api.NewHTTPServer(coordinator, cfg)

	go func() {
		log.Printf("✅ HTTP API server starting at %s", httpAddr)
		if err := httpServer.Start(httpAddr); err != nil {
			log.Fatalf("❌ HTTP server failed: %v", err)
		}
	}()

	log.Println("🎉 All services started successfully")
	log.Printf("   - gRPC: %s", grpcAddr)
	log.Printf("   - HTTP API: %s", httpAddr)
	log.Printf("   - Peers configured: %d", len(cfg.Peers))

	// Start gRPC server (blocking)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("❌ Failed to serve: %v", err)
	}
}

func loadConfig(path string) (*config.Config, error) {
	// Try to find config file in multiple locations
	locations := []string{
		path,
		filepath.Join(".", "config.yaml"),
		filepath.Join(os.Getenv("HOME"), ".enx", "config.yaml"),
		"/etc/enx/config.yaml",
	}

	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return config.LoadConfig(loc)
		}
	}

	return nil, fmt.Errorf("config file not found in any location")
}

func getDefaultConfig() *config.Config {
	return &config.Config{
		Node: config.NodeConfig{
			ID:       "default-node",
			GRPCPort: 50051,
			HTTPPort: 8090,
		},
		Peers: []config.PeerConfig{},
	}
}
