# Version Information Examples

This document shows how version information is extracted from Git and used in the deployment process.

## Version Sources

### 1. Manual Version Override
```bash
# Deploy with specific version
./deploy/deploy.sh 1.0.0
# Result: VERSION = "1.0.0"
```

### 2. Git Tag Detection
```bash
# If you have a tag like v1.2.3
git tag v1.2.3
./deploy/deploy.sh
# Result: VERSION = "v1.2.3"
```

### 3. Git Describe (Current Behavior)
```bash
# Current state: no tags, dirty working directory
./deploy/deploy.sh
# Result: VERSION = "3c3853c-dirty"
```

### 4. Fallback to "dev"
```bash
# If git commands fail completely
./deploy/deploy.sh
# Result: VERSION = "dev"
```

## Git Describe Output Examples

### With Tags
```bash
# Clean tag
git tag v1.0.0
git describe --tags --always --dirty
# Output: v1.0.0

# Tag with commits ahead
git describe --tags --always --dirty
# Output: v1.0.0-2-g3c3853c

# Tag with commits ahead and dirty
git describe --tags --always --dirty
# Output: v1.0.0-2-g3c3853c-dirty
```

### Without Tags
```bash
# No tags, clean
git describe --tags --always --dirty
# Output: 3c3853c

# No tags, dirty
git describe --tags --always --dirty
# Output: 3c3853c-dirty
```

## Version Information in API Response

### Example 1: Manual Version
```bash
./deploy/deploy.sh 2.1.0
```

API Response:
```json
{
  "success": true,
  "data": {
    "version": "2.1.0",
    "build_time": "2024-01-15_10:30:45_UTC",
    "git_commit": "3c3853cc619d53a2700b403eb176832dbd9b4c46",
    "git_branch": "main",
    "go_version": "go1.23.0",
    "uptime": "5m 30s"
  },
  "message": "Version information retrieved successfully"
}
```

### Example 2: Git Tag Version
```bash
git tag v1.5.0
./deploy/deploy.sh
```

API Response:
```json
{
  "success": true,
  "data": {
    "version": "v1.5.0",
    "build_time": "2024-01-15_10:30:45_UTC",
    "git_commit": "3c3853cc619d53a2700b403eb176832dbd9b4c46",
    "git_branch": "main",
    "go_version": "go1.23.0",
    "uptime": "2h 15m 30s"
  },
  "message": "Version information retrieved successfully"
}
```

### Example 3: Development Version
```bash
# No tags, dirty working directory
./deploy/deploy.sh
```

API Response:
```json
{
  "success": true,
  "data": {
    "version": "3c3853c-dirty",
    "build_time": "2024-01-15_10:30:45_UTC",
    "git_commit": "3c3853cc619d53a2700b403eb176832dbd9b4c46",
    "git_branch": "main",
    "go_version": "go1.23.0",
    "uptime": "1d 3h 20m 15s"
  },
  "message": "Version information retrieved successfully"
}
```

## Uptime Format Examples

The uptime field shows how long the API has been running since the last restart:

### Short Durations (milliseconds precision)
- `500ms` - Less than 1 second
- `1s 500ms` - 1 second and 500 milliseconds

### Medium Durations (seconds precision)
- `30s` - 30 seconds
- `2m 30s` - 2 minutes and 30 seconds
- `15m 45s` - 15 minutes and 45 seconds

### Long Durations (seconds precision)
- `2h 15m 30s` - 2 hours, 15 minutes, and 30 seconds
- `1d 3h 20m 15s` - 1 day, 3 hours, 20 minutes, and 15 seconds

### Precision Rules
- **< 1 second**: Shows milliseconds (e.g., `500ms`)
- **< 1 minute**: Shows seconds with milliseconds (e.g., `30s 500ms`)
- **< 1 hour**: Shows minutes and seconds (e.g., `45m 30s`)
- **< 1 day**: Shows hours, minutes, and seconds (e.g., `2h 15m 30s`)
- **≥ 1 day**: Shows days, hours, minutes, and seconds (e.g., `1d 3h 20m 15s`)

## Best Practices for Version Management

### 1. Use Semantic Versioning Tags
```bash
# Create release tags
git tag v1.0.0
git tag v1.1.0
git tag v2.0.0

# Push tags to remote
git push origin --tags
```

### 2. Clean Working Directory for Releases
```bash
# Before creating a release tag
git add .
git commit -m "Prepare for v1.0.0 release"
git tag v1.0.0
./deploy/deploy.sh
```

### 3. Development vs Production
```bash
# Development builds (automatic)
./deploy/deploy.sh
# Uses git describe output

# Production releases (manual)
./deploy/deploy.sh v1.0.0
# Uses specified version
```

### 4. CI/CD Integration
```bash
# In CI/CD pipeline, use git tag
VERSION=$(git describe --tags --always --dirty)
./deploy/deploy.sh "$VERSION"
```

### 5. Monitor Uptime
```bash
# Check uptime via API
curl http://192.168.50.36:8080/version | jq '.data.uptime'

# Monitor for long-running instances
curl http://192.168.50.36:8080/version | jq '.data.uptime' | grep -E "d|h"
```

## Version Information Components

| Component | Source | Example |
|-----------|--------|---------|
| `version` | Git tag or manual | `v1.0.0` |
| `git_commit` | Git commit hash | `3c3853cc619d53a2700b403eb176832dbd9b4c46` |
| `git_branch` | Current branch | `main` |
| `build_time` | UTC timestamp | `2024-01-15_10:30:45_UTC` |
| `go_version` | Go runtime | `go1.23.0` |
| `uptime` | Runtime duration | `2h 15m 30s` | 