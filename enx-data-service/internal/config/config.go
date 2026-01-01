package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Node  NodeConfig   `yaml:"node"`
	Peers []PeerConfig `yaml:"peers"`
}

type NodeConfig struct {
	ID       string `yaml:"id"`
	GRPCPort int    `yaml:"grpc_port"`
	HTTPPort int    `yaml:"http_port"`
}

type PeerConfig struct {
	Addr string `yaml:"addr"`
	Name string `yaml:"name"`
}

func LoadConfig(path string) (*Config, error) {
	// 1. Load .env file if exists (using Viper)
	viper.SetConfigFile(".env")
	viper.SetConfigType("env")
	viper.AutomaticEnv()

	// Try to read .env file (ignore error if not found)
	_ = viper.ReadInConfig()

	// 2. Load YAML config file
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// 3. Override with environment variables (from .env or system)
	if nodeID := viper.GetString("NODE_ID"); nodeID != "" {
		config.Node.ID = nodeID
	}
	if grpcPort := viper.GetInt("GRPC_PORT"); grpcPort > 0 {
		config.Node.GRPCPort = grpcPort
	}
	if httpPort := viper.GetInt("HTTP_PORT"); httpPort > 0 {
		config.Node.HTTPPort = httpPort
	}

	// Parse PEERS from environment variable
	if peersStr := viper.GetString("PEERS"); peersStr != "" {
		peerAddrs := strings.Split(peersStr, ",")

		// Override peers from config
		config.Peers = []PeerConfig{}
		for i, addr := range peerAddrs {
			addr = strings.TrimSpace(addr)
			if addr == "" {
				continue
			}

			// Auto-generate peer name
			name := fmt.Sprintf("peer-%d", i+1)

			config.Peers = append(config.Peers, PeerConfig{
				Addr: addr,
				Name: name,
			})
		}
	}

	// 4. Set default values
	if config.Node.GRPCPort == 0 {
		config.Node.GRPCPort = 50051
	}
	if config.Node.HTTPPort == 0 {
		config.Node.HTTPPort = 8090
	}

	return &config, nil
}
