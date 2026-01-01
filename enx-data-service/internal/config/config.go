package config

import (
	"fmt"
	"os"

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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	if config.Node.GRPCPort == 0 {
		config.Node.GRPCPort = 50051
	}
	if config.Node.HTTPPort == 0 {
		config.Node.HTTPPort = 8090
	}

	return &config, nil
}
