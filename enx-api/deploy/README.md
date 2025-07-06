# Deployment Scripts

This directory contains deployment scripts for the enx-api service.

## Scripts Overview

### deploy.sh (Universal)
- **Purpose**: Universal deployment script that works on both Linux and macOS
- **Target**: 192.168.50.36
- **Features**: 
  - Automatic platform detection
  - Version information injection
  - Cross-compilation support (macOS)
  - Comprehensive API testing
  - **Version display after deployment**

### jenkins-deploy.sh
- **Purpose**: Jenkins CI/CD deployment script
- **Target**: AWS (wiloon.com)
- **Features**: 
  - CI/CD optimized
  - Custom SSH port (1022)
  - JSON version API testing
  - **Version display after deployment**

### test-deploy.sh
- **Purpose**: Test script to verify deploy.sh functionality
- **Features**: 
  - Platform detection testing
  - Build command generation
  - No actual deployment

### test-version-display.sh
- **Purpose**: Test script to demonstrate version display functionality
- **Features**: 
  - Simulates version API parsing
  - Tests both jq and grep fallback methods
  - Shows expected output format

## Quick Start

### Basic Deployment
```bash
# Deploy with automatic version detection
./deploy/deploy.sh

# Deploy with specific version
./deploy/deploy.sh 1.0.0
```

### Test Deployment Logic
```bash
# Test platform detection and build logic
./deploy/test-deploy.sh

# Test version display functionality
./deploy/test-version-display.sh
```

## Platform-Specific Behavior

### Linux Environment
- Uses `build/` directory for output
- Uses Ansible for file transfer
- Uses SHA256 checksums
- Uses `~/.ssh/id_ed25519_w10n` key

### macOS Environment
- Uses current directory for output
- Uses SCP for file transfer
- Uses MD5 checksums
- Uses `~/.ssh/id_ed25519` key
- Enables cross-compilation for Linux target

## Version Display Feature

After successful deployment, all scripts now display the deployed version information:

```
=== Current Deployed Version ===
Version: 1.0.0
Commit:  3c3853cc619d53a2700b403eb176832dbd9b4c46
Branch:  main
Built:   2024-01-15_10:30:45_UTC
✓ Successfully deployed version 1.0.0
==================================
```

### Features
- **Automatic parsing**: Uses `jq` if available, falls back to `grep`
- **Error handling**: Gracefully handles API failures
- **Clear formatting**: Easy-to-read version information
- **Deployment confirmation**: Shows exactly what version was deployed

### Dependencies
- **jq** (optional): For better JSON parsing
- **curl**: For API calls
- **grep/cut**: Fallback parsing method

## Migration from Old Scripts

The `macos.sh` script has been merged into `deploy.sh`. If you were using:

```bash
# Old way
./deploy/macos.sh

# New way (works on both platforms)
./deploy/deploy.sh
```

## Version Information

All scripts automatically inject version information:
- Git tag or "dev" if no tag
- Git commit hash
- Git branch name
- UTC build timestamp

## API Testing

After deployment, the script tests:
- Ping endpoint: `http://192.168.50.36:8080/ping`
- Version endpoint: `http://192.168.50.36:8080/version`

## Troubleshooting

### SSH Key Issues
- **Linux**: Ensure `~/.ssh/id_ed25519_w10n` exists
- **macOS**: Ensure `~/.ssh/id_ed25519` exists

### Cross-compilation Issues (macOS)
- Install required cross-compilation tools
- Ensure `x86_64-unknown-linux-gnu-gcc` is available

### Version Display Issues
- Ensure the service is running and accessible
- Check that port 8080 is open
- Verify the version API endpoint is working

### Service Issues
```bash
# Check service status
ssh root@192.168.50.36 'systemctl status enx-api'

# Check logs
ssh root@192.168.50.36 'journalctl -u enx-api -f'

# Test version API manually
curl http://192.168.50.36:8080/version
```

## Files

- `deploy.sh` - Universal deployment script
- `jenkins-deploy.sh` - Jenkins CI/CD script
- `test-deploy.sh` - Test script
- `test-version-display.sh` - Version display test script
- `enx-api.service` - Systemd service file
- `DEPLOYMENT_WITH_VERSION.md` - Detailed documentation
- `version-examples.md` - Version information examples 