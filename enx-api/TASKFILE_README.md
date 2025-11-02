# Taskfile Usage Guide

This project uses [Task](https://taskfile.dev) as a task runner for local development.

## Installation

Install Task on macOS:

```bash
brew install go-task/tap/go-task
```

Or using go install:

```bash
go install github.com/go-task/task/v3/cmd/task@latest
```

## Quick Start

### View all available tasks
```bash
task --list
# or simply
task
```

### Run the application locally
```bash
# Using go run (fastest for development)
task run

# Or build first, then run the binary
task run:binary

# Complete setup and run
task run:local
```

### Development with hot reload
```bash
task dev
```
This will install `air` if not present and start the app with automatic reloading on code changes.

## Common Tasks

### Building

```bash
# Development build (fast, no version info)
task build:dev

# Production build (with version info)
task build
```

### Testing

```bash
# Run all tests
task test

# Run tests with coverage
task test:coverage

# Test a specific package
task test:pkg PKG=./enx
```

### Code Quality

```bash
# Format code
task fmt

# Run go vet
task vet

# Run linter (requires golangci-lint)
task lint

# Run all checks
task check
```

### Maintenance

```bash
# Download dependencies
task deps

# Tidy dependencies
task tidy

# Clean build artifacts
task clean

# Check development environment
task check:env

# Show version info
task version
```

### Database

```bash
# Run database migrations
task migrate
```

### CI/CD

```bash
# Complete CI build process
task ci:build
```

## Development Workflow

### First time setup
```bash
task dev:setup
```

### Regular development
```bash
# Option 1: Hot reload (recommended)
task dev

# Option 2: Manual run
task run

# Option 3: Build and run
task run:binary
```

### Before committing
```bash
task check
```

## Configuration

- Main config: `config.toml`
- Hot reload config: `.air.toml`
- Task definitions: `Taskfile.yml`

## Requirements

- Go 1.23.0 or later
- Task runner installed
- (Optional) golangci-lint for linting
- (Optional) air for hot reload (auto-installed by `task dev`)

## Environment Variables

The application uses `config.toml` for configuration. Make sure it exists before running.

## Tips

- Use `task run` for quick development without building
- Use `task dev` for hot reload during active development
- Use `task build` before deployment to get version information
- Run `task check` before pushing code to ensure quality

## Troubleshooting

### Config file not found
Make sure `config.toml` exists in the project root.

### Port already in use
Check if another instance is running or change the port in `config.toml`.

### Dependencies issues
```bash
task clean
task deps
task tidy
```

### Air not working
```bash
go install github.com/cosmtrek/air@latest
task dev
```
