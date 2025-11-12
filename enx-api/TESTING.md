# Testing Guide

This document explains the testing strategy and how to run different types of tests.

## Test Types

### Unit Tests
- **Location**: `*_test.go` files without build tags
- **Purpose**: Test pure business logic without external dependencies
- **Speed**: Fast (milliseconds)
- **Dependencies**: None (no database, no config files)
- **Examples**: 
  - `enx/ecp_test.go` - Tests string processing logic like `SetEnglish()`
  - `version/version_test.go` - Tests version formatting
  - `repo/redisx/redis_test.go` - Tests utility functions

### Integration Tests
- **Location**: `*_integration_test.go` or `*_test.go` files with `//go:build integration` tag
- **Purpose**: Test components working together with real dependencies
- **Speed**: Slower (seconds)
- **Dependencies**: Requires database and configuration files
- **Examples**:
  - `enx/ecp_integration_test.go` - Tests word save/translate with database
  - `paragraph/paragraph_test.go` - Tests text processing with database lookup
  - `repo/repo_test.go` - Tests repository layer with database
  - `youdao/youdao_test.go` - Tests external API integration

## Running Tests

### Quick Development (Unit Tests Only)
```bash
# Run unit tests - fast, no setup required
task test              # All projects
task test-unit         # All projects (explicit)
task test-unit-api     # enx-api only
cd enx-api && task test
```

**Output**: Only pure unit tests run, takes ~1 second

### Integration Tests (Requires Setup)
```bash
# Run integration tests - requires database and config
task test-integration         # All projects
task test-integration-api     # enx-api only
cd enx-api && task test-integration
```

**Prerequisites**:
- Database: `enx-api/enx.db` (auto-created from `enx.sql`)
- Config: `enx-api/config.toml` (auto-copied from `config-e2e.toml`)

### All Tests
```bash
# Run both unit and integration tests
task test-all              # All projects
cd enx-api && task test-all
```

## Test Structure

### Unit Test Example
```go
// enx/ecp_test.go
package enx

import "testing"

// No database, no config, just logic
func TestWordSuffix(t *testing.T) {
    word := Word{}
    word.SetEnglish("DHC-")
    if word.English != "DHC" {
        t.Errorf("test failed")
    }
}
```

### Integration Test Example
```go
// enx/ecp_integration_test.go
//go:build integration
// +build integration

package enx

import (
    "testing"
    "enx-api/utils/sqlitex"
    "enx-api/utils/logger"
)

func init() {
    logger.Init("CONSOLE", "debug", "rssx-api")
    sqlitex.Init()
}

func TestRemoveDuplcateWord(t *testing.T) {
    word := Word{}
    word.SetEnglish("Kehinde")
    word.Save()              // Requires database
    word.Translate(1)        // Requires database
    // ... assertions
}
```

## CI/CD Pipeline

### Recommended Pipeline
```bash
# Stage 1: Fast feedback (unit tests)
task test-unit              # ~1 second

# Stage 2: Full validation (integration tests)
task test-integration       # ~5-10 seconds

# Or run everything at once
task test-all
```

### GitHub Actions Example
```yaml
- name: Unit Tests
  run: task test-unit
  
- name: Integration Tests
  run: task test-integration
```

## Adding New Tests

### Unit Test (Preferred)
1. Create test in same package: `myfile_test.go`
2. Test pure logic without dependencies
3. No `init()` function with database/config setup
4. Run with `task test`

### Integration Test (When Necessary)
1. Create test file: `myfile_integration_test.go`
2. Add build tag at top:
   ```go
   //go:build integration
   // +build integration
   ```
3. Set up dependencies in `init()` if needed
4. Run with `task test-integration`

## Best Practices

### ✅ Do
- Write unit tests for business logic
- Keep unit tests fast (< 100ms each)
- Use integration tests for database/API interactions
- Run unit tests frequently during development
- Run integration tests before committing

### ❌ Don't
- Don't add database dependencies to unit tests
- Don't skip tests because they're slow (separate them instead)
- Don't mix unit and integration test logic
- Don't commit without running tests

## Troubleshooting

### "no such table: words"
**Problem**: Running integration tests without database setup
**Solution**: Use `task test-integration` which auto-creates database

### "Config File not found"
**Problem**: Running integration tests without config file
**Solution**: Use `task test-integration` which auto-copies config

### Tests are slow
**Problem**: Running all tests including integration tests
**Solution**: Use `task test-unit` for fast feedback during development

### Build tag warnings in IDE
**Problem**: IDE shows "No packages found" for integration test files
**Solution**: This is expected - integration tests are excluded by default. Configure IDE to include build tags if needed:
```json
// VSCode settings.json
{
  "gopls": {
    "buildFlags": ["-tags=integration"]
  }
}
```

## Summary

- **Fast development**: `task test-unit` (no database, ~1 second)
- **Full validation**: `task test-integration` (with database, ~10 seconds)
- **Everything**: `task test-all` (both types)
- **CI/CD**: Run both types in sequence
