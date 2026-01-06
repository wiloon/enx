package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"enx-sync/internal/api"
	"enx-sync/internal/config"
	"enx-sync/internal/repository"
	"enx-sync/internal/service"
	"enx-sync/internal/sync"
	pb "enx-sync/proto"

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

	// Get local IP addresses
	localIPs := getLocalIPs()

	log.Println("🎉 All services started successfully")
	log.Printf("   Node ID: %s", cfg.Node.ID)
	log.Printf("   Local IPs:")
	for _, ip := range localIPs {
		log.Printf("      - %s", ip)
	}
	log.Printf("   gRPC endpoints:")
	log.Printf("      - localhost:%d", cfg.Node.GRPCPort)
	for _, ip := range localIPs {
		log.Printf("      - %s:%d", ip, cfg.Node.GRPCPort)
	}
	log.Printf("   HTTP API endpoints:")
	log.Printf("      - localhost:%d", cfg.Node.HTTPPort)
	for _, ip := range localIPs {
		log.Printf("      - %s:%d", ip, cfg.Node.HTTPPort)
	}
	log.Printf("   Peers configured: %d", len(cfg.Peers))

	// Auto-sync with all peers on startup
	if len(cfg.Peers) > 0 {
		go func() {
			// Wait a bit for services to fully start
			time.Sleep(2 * time.Second)

			log.Println("🔄 Starting initial sync with peers...")
			for _, peer := range cfg.Peers {
				peerAddr := peer.Addr
				// Add default port if not specified
				if !strings.Contains(peerAddr, ":") {
					peerAddr = fmt.Sprintf("%s:50051", peerAddr)
				}

				// Check if peer is reachable first
				log.Printf("   - Checking %s (%s)...", peer.Name, peerAddr)
				if !isPeerReachable(peerAddr, 3*time.Second) {
					log.Printf("   ⚠️  Peer %s is not reachable, skipping sync", peer.Name)
					continue
				}

				log.Printf("   - Syncing with %s (%s)...", peer.Name, peerAddr)
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := coordinator.SyncWithPeer(ctx, peerAddr)
				cancel()

				if err != nil {
					log.Printf("   ⚠️  Failed to sync with %s: %v", peerAddr, err)
				} else {
					log.Printf("   ✅ Sync completed with %s", peerAddr)
				}
			}
			log.Println("✅ Initial sync completed")
		}()
	}

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

func getLocalIPs() []string {
	var ips []string

	interfaces, err := net.Interfaces()
	if err != nil {
		log.Printf("⚠️  Failed to get network interfaces: %v", err)
		return ips
	}

	for _, iface := range interfaces {
		// Skip loopback and down interfaces
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			// Skip loopback and IPv6 addresses for simplicity
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}

			ips = append(ips, ip.String())
		}
	}

	return ips
}

// isPeerReachable checks if a peer is reachable by attempting a TCP connection
func isPeerReachable(peerAddr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", peerAddr, timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
