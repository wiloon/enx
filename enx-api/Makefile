# Makefile for enx-api

.PHONY: build build-dev clean test version help

# Default target
all: build

# Build with version information
build:
	@echo "Building enx-api with version information..."
	@./build/build.sh

# Build for development (without version injection)
build-dev:
	@echo "Building enx-api for development..."
	@go build -o enx-api .

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -f enx-api
	@rm -f *.exe

# Run tests
test:
	@echo "Running tests..."
	@go test ./...

# Show version information
version:
	@echo "Current version information:"
	@echo "  Version: $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")"
	@echo "  Git Commit: $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")"
	@echo "  Git Branch: $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"

# Build with specific version
build-version:
	@if [ -z "$(VERSION)" ]; then \
		echo "Usage: make build-version VERSION=1.0.0"; \
		exit 1; \
	fi
	@echo "Building enx-api with version $(VERSION)..."
	@./build/build.sh $(VERSION)

# Help
help:
	@echo "Available targets:"
	@echo "  build         - Build with version information"
	@echo "  build-dev     - Build for development (no version injection)"
	@echo "  build-version - Build with specific version (VERSION=1.0.0)"
	@echo "  clean         - Clean build artifacts"
	@echo "  test          - Run tests"
	@echo "  version       - Show current version information"
	@echo "  help          - Show this help message" 