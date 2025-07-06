# Deployment with Version Information

This document describes how to use the updated deployment scripts that include version information injection.

## Overview

All deployment scripts have been updated to automatically inject version information during the build process. This includes:

- Git version/tag
- Git commit hash
- Git branch name
- Build timestamp

## Updated Deployment Scripts

### 1. deploy.sh (Universal - Linux/macOS)

**Usage:**
```bash
# Deploy with automatic version detection
./deploy/deploy.sh

# Deploy with specific version
./deploy/deploy.sh 1.0.0
```

**Features:**
- **Universal script**: Works on both Linux and macOS
- **Automatic platform detection**: Detects OS and adjusts build strategy
- **Cross-compilation support**: On macOS, uses custom C compiler for Linux target
- **Smart file transfer**: Uses SCP on macOS, Ansible on Linux
- **Automatic cleanup**: Removes local build files on macOS
- **Comprehensive testing**: Tests both ping and version APIs after deployment
- **Deploys to**: 192.168.50.36

**Platform-specific behavior:**
- **Linux**: Uses build directory, Ansible for file transfer, SHA256 checksums
- **macOS**: Uses current directory, SCP for file transfer, MD5 checksums, cross-compilation

### 2. jenkins-deploy.sh (Jenkins CI/CD)

**Usage:**
```bash
# Deploy with automatic version detection
./deploy/jenkins-deploy.sh

# Deploy with specific version
./deploy/jenkins-deploy.sh 1.0.0
```

**Features:**
- Runs on Jenkins CI/CD server
- Deploys to AWS (wiloon.com)
- Uses custom SSH port (1022)
- Tests version API with JSON formatting

## Version Information Sources

### Automatic Detection
- **Version**: Git tag (e.g., `v1.0.0`) or `dev` if no tag
- **Git Commit**: Current commit hash
- **Git Branch**: Current branch name
- **Build Time**: UTC timestamp

### Manual Override
You can override the version by passing it as the first argument:
```bash
./deploy/deploy.sh 2.1.0
```

## Build Process

The build process now includes version injection:

```bash
go build -ldflags "-X enx-server/version.Version=$VERSION \
                   -X enx-server/version.GitCommit=$GIT_COMMIT \
                   -X enx-server/version.GitBranch=$GIT_BRANCH \
                   -X enx-server/version.BuildTime=$BUILD_TIME" \
         -o enx-api enx-api.go
```

## Platform-Specific Build Details

### Linux Environment
- **Source directory**: `/home/wiloon/workspace/enx/enx-api`
- **Output directory**: `build/`
- **SSH key**: `~/.ssh/id_ed25519_w10n`
- **File transfer**: Ansible
- **Checksum**: SHA256

### macOS Environment
- **Source directory**: `/Users/wiloon/workspace/projects/enx/enx-api`
- **Output directory**: `.` (current directory)
- **SSH key**: `~/.ssh/id_ed25519`
- **File transfer**: SCP
- **Checksum**: MD5
- **Cross-compilation**: Uses `x86_64-unknown-linux-gnu-gcc`

## Deployment Verification

After deployment, you can verify the version information:

```bash
# Check detailed version information
curl http://192.168.50.36:8080/version

# Check simple version information
curl http://192.168.50.36:8080/api/version

# Check service status
ssh root@192.168.50.36 'systemctl status enx-api'
```

### Expected Response
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

## Environment-Specific Notes

### Local Development
- Use `make build-dev` for development builds without version injection
- Use `make build` for production-like builds with version injection

### CI/CD Pipeline
- Jenkins automatically detects version from Git
- Version information is logged during build process
- Deployment includes version API testing

### Production Deployment
- All production deployments include version information
- Version API is available for monitoring and debugging
- Health checks can include version verification

## Migration from Old Scripts

If you were previously using `macos.sh`, you can now use the unified `deploy.sh`:

```bash
# Old way (macOS only)
./deploy/macos.sh

# New way (works on both platforms)
./deploy/deploy.sh
```

The unified script automatically detects your platform and uses the appropriate build and deployment strategy.

## Troubleshooting

### Version shows as "dev"
- Ensure Git repository is properly initialized
- Check that Git tags are available
- Verify Git commands work in deployment environment

### Build fails with ldflags
- Ensure version package path is correct
- Check that all required variables are defined
- Verify Go module setup

### Cross-compilation fails on macOS
- Ensure you have the required cross-compilation tools installed
- Check that `x86_64-unknown-linux-gnu-gcc` is available
- Verify CGO environment variables are set correctly

### Version API not accessible
- Check that service is running: `systemctl status enx-api`
- Verify port 8080 is open
- Check firewall settings

### SSH key issues
- **Linux**: Ensure `~/.ssh/id_ed25519_w10n` exists and has correct permissions
- **macOS**: Ensure `~/.ssh/id_ed25519` exists and has correct permissions

## Best Practices

1. **Tag your releases**: Use Git tags for version management
2. **Test version API**: Always verify version information after deployment
3. **Monitor deployments**: Use version API for deployment verification
4. **Document versions**: Keep track of deployed versions for troubleshooting
5. **Use unified script**: Use `deploy.sh` for all deployments regardless of platform 