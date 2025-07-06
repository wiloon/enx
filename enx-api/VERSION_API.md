# Version API Documentation

This document describes the version API implementation for enx-api.

## Overview

The version API provides information about the current deployment version, build time, git commit, and other relevant details. This is useful for:

- Monitoring which version is currently deployed
- Debugging issues by identifying the exact code version
- CI/CD pipeline integration
- Client-side version checking

## API Endpoints

### 1. Detailed Version Information

**Endpoint:** `GET /version`

**Description:** Returns comprehensive version information including build details.

**Response:**
```json
{
  "success": true,
  "data": {
    "version": "1.0.0",
    "build_time": "2024-01-15_10:30:45_UTC",
    "git_commit": "a1b2c3d4e5f6",
    "git_branch": "main",
    "go_version": "go1.23.0"
  },
  "message": "Version information retrieved successfully"
}
```

### 2. Simple Version Information

**Endpoint:** `GET /api/version`

**Description:** Returns basic version information in a simplified format.

**Response:**
```json
{
  "version": "1.0.0",
  "commit": "a1b2c3d4e5f6",
  "build_time": "2024-01-15_10:30:45_UTC"
}
```

## Building with Version Information

### Using the Build Script

```bash
# Build with automatic version detection
./build/build.sh

# Build with specific version
./build/build.sh 1.0.0
```

### Using Makefile

```bash
# Build with version information
make build

# Build for development (no version injection)
make build-dev

# Build with specific version
make build-version VERSION=1.0.0

# Show current version information
make version
```

### Manual Build

```bash
go build -ldflags "-X enx-server/version.Version=1.0.0 \
                   -X enx-server/version.GitCommit=$(git rev-parse HEAD) \
                   -X enx-server/version.GitBranch=$(git rev-parse --abbrev-ref HEAD) \
                   -X enx-server/version.BuildTime=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')" \
         -o enx-api .
```

## Version Information Sources

- **Version**: Git tag or manually specified version
- **Git Commit**: Current git commit hash
- **Git Branch**: Current git branch name
- **Build Time**: UTC timestamp when the binary was built
- **Go Version**: Go runtime version used for compilation

## Integration Examples

### Frontend Integration

```javascript
// Check API version
async function checkApiVersion() {
  try {
    const response = await fetch('/api/version');
    const data = await response.json();
    console.log('API Version:', data.version);
    console.log('Git Commit:', data.commit);
  } catch (error) {
    console.error('Failed to get version info:', error);
  }
}
```

### Health Check Integration

```bash
# Use version API in health checks
curl -f http://localhost:8080/version || exit 1
```

### Monitoring Integration

```bash
# Extract version for monitoring
VERSION=$(curl -s http://localhost:8080/api/version | jq -r '.version')
echo "Current API version: $VERSION"
```

## Development Notes

- Version information is injected at compile time using Go's `-ldflags`
- Default values are used when git information is not available
- The API endpoints do not require authentication
- Version information is read-only and cannot be modified at runtime

## Troubleshooting

### Version shows as "dev"
- Ensure you're building with the build script or Makefile
- Check that git repository is properly initialized
- Verify that git tags are available

### Build fails with ldflags
- Ensure the version package path is correct
- Check that all required variables are defined in version.go
- Verify Go module setup is correct 