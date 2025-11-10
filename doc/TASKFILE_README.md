# Taskfile Guide for ENX Monorepo

This document describes the root-level Taskfile for managing all ENX projects.

## Overview

The ENX monorepo consists of multiple projects:
- **enx-api**: Go backend API
- **enx-chrome**: Chrome extension
- **enx-ui**: Next.js frontend
- **mock-api**: Mock API server

The root Taskfile provides a unified interface to manage all projects from a single location.

## Installation

First, install Task if you haven't already:

```bash
# macOS
brew install go-task/tap/go-task

# Linux (snap)
sudo snap install task --classic

# Or download from https://taskfile.dev/installation/
```

## Task Categories

### 1. Setup & Installation

```bash
# Setup all projects
task setup

# Setup individual projects
task setup-api
task setup-chrome
task setup-ui
```

### 2. Development

```bash
# 🎯 ONE-COMMAND DEVELOPMENT MODE (Recommended)
task dev-all              # Start API + Chrome watch + Chrome browser (all in background)

# Start with custom URL
task dev-all URL=https://www.bbc.com/news

# View development logs
task dev-logs             # Show recent logs
tail -f enx-api/logs/dev.log       # Follow API logs in real-time
tail -f enx-chrome/logs/watch.log  # Follow Chrome watch logs

# Stop all services
task stop-dev

# OR start individual services in separate terminals
task dev-api              # Start API with hot reload
task dev-chrome           # Start Chrome extension dev server
task dev-chrome-browser   # Open Chrome with extension loaded
task dev-ui              # Start Next.js UI
```

### 3. Building

```bash
# Build all projects
task build

# Build individual projects
task build-api
task build-chrome
task build-ui
```

### 4. Testing

```bash
# Run all tests
task test

# Run tests for individual projects
task test-api
task test-chrome
task test-chrome-e2e
task test-ui

# Run tests with coverage
task test-coverage
task test-coverage-api
task test-coverage-chrome
```

### 5. Code Quality

```bash
# Lint all projects
task lint

# Format all projects
task format

# Run all checks (lint + test)
task check

# Individual project checks
task check-api
task check-chrome
task check-ui
```

### 6. Cleaning

```bash
# Clean all build artifacts
task clean

# Clean individual projects
task clean-api
task clean-chrome
task clean-ui
```

### 7. Packaging & Distribution

```bash
# Pack Chrome extension for Chrome Web Store
task pack-chrome
```

### 8. Utilities

```bash
# Show version information for all projects
task version

# Show project information
task info

# Database migrations
task migrate

# Start mock API server
task mock-api
```

### 9. CI/CD

```bash
# Complete CI workflow (install, lint, test, build)
task ci

# Individual project CI workflows
task ci-api
task ci-chrome
```

## How It Works

The root Taskfile calls sub-tasks in child directories using:

```yaml
task-name:
  desc: Task description
  dir: enx-api              # Change to subdirectory
  cmds:
    - task: subtask-name    # Call task from subdirectory's Taskfile
```

This allows you to:
1. **Centralized control** - Manage all projects from the root
2. **Consistent interface** - Same commands work across all projects
3. **Flexible execution** - Can run tasks for all projects or individual ones
4. **Task reuse** - Leverage existing Taskfiles in subdirectories

## Common Workflows

### Starting Development Environment

#### Option 1: One Command (Recommended) 🚀

```bash
# Start everything with one command
task dev-all

# Or with custom URL
task dev-all URL=https://www.bbc.com/news

# Check logs
task dev-logs

# Stop when done
task stop-dev
```

This will:
1. Create log directories if they don't exist (`enx-api/logs`, `enx-chrome/logs`)
2. Start enx-api in background with hot reload
3. Start enx-chrome watch mode in background (auto-rebuild on changes)
4. Open Chrome browser with extension loaded
5. All logs saved to each project's `logs/` directory

#### Option 2: Separate Terminals

```bash
# Terminal 1
task dev-api

# Terminal 2
task dev-chrome

# Terminal 3 (optional)
task dev-chrome-browser

# Terminal 4 (optional)
task dev-ui
```

### Before Committing Code

```bash
# Run all checks
task check

# Or step by step
task lint
task test
```

### Complete CI/CD Pipeline

```bash
task ci
```

This will:
1. Install all dependencies
2. Lint all code
3. Run all tests
4. Build all projects

### Fresh Start

```bash
# Clean everything
task clean

# Reinstall and rebuild
task setup
task build
```

## Tips

1. **List all tasks**: `task --list`
2. **Task help**: `task --summary <task-name>`
3. **Parallel execution**: Task automatically parallelizes independent tasks
4. **Variables**: Pass variables like `task dev-chrome-browser URL=https://example.com`
5. **Subdirectory tasks**: Each project has its own Taskfile with more specific tasks

## Project-Specific Tasks

For more detailed tasks specific to each project, refer to:
- `enx-api/TASKFILE_README.md`
- `enx-chrome/TASKFILE_README.md`

## Integration with IDEs

### VS Code

Add to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Task: dev-api",
      "type": "shell",
      "command": "task dev-api",
      "problemMatcher": [],
      "group": "build"
    }
  ]
}
```

### IntelliJ IDEA / GoLand

1. Run → Edit Configurations → Add New → Shell Script
2. Script text: `task dev-api`
3. Working directory: Project root

## Troubleshooting

### "task: command not found"

Install Task from https://taskfile.dev/installation/

### Port already in use

```bash
# Check what's using the port
lsof -i :8090  # API port
lsof -i :3000  # UI port

# Kill the process
kill -9 <PID>
```

### Dependencies not installed

```bash
task clean
task setup
```

## Architecture Benefits

This hierarchical Taskfile structure provides:

1. **Separation of concerns**: Each project manages its own tasks
2. **Unified interface**: Root Taskfile provides high-level orchestration
3. **Maintainability**: Changes to project-specific tasks don't affect root Taskfile
4. **Scalability**: Easy to add new projects or tasks
5. **Team consistency**: Everyone uses the same commands

## References

- [Task Documentation](https://taskfile.dev/)
- [enx-api Taskfile](enx-api/TASKFILE_README.md)
- [enx-chrome Taskfile](enx-chrome/TASKFILE_README.md)

---

*For questions or improvements, please update this document and commit changes.*
