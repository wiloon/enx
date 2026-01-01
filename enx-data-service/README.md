````markdown
# ENX Data Service

Phase 3: Manual Sync Trigger

## Overview

Phase 3 implements HTTP API and CLI tools for manually triggering P2P synchronization.

## Architecture

- **gRPC Service** (Port 50051): Data synchronization RPC
- **HTTP API** (Port 8090): Control interface for triggering sync
- **CLI Script**: User-friendly command-line wrapper

## Configuration

Edit `config.yaml`:

```yaml
node:
  id: "desktop-001"
  grpc_port: 50051
  http_port: 8090

peers:
  - addr: "192.168.1.10:50051"
    name: "macbook"
  - addr: "192.168.1.20:50051"
    name: "ubuntu-laptop"
```

## Quick Start

### 1. Build

```bash
go build -o bin/server ./cmd/server
```

### 2. Run Server

```bash
# With custom config
./bin/server --config config.yaml --db /var/lib/enx-api/enx.db

# With defaults
./bin/server
```

### 3. Use CLI

```bash
# Make CLI accessible
export PATH=$PATH:$(pwd)/scripts

# Check service health
enx-sync health

# View sync status
enx-sync status

# Trigger sync with specific peer
enx-sync trigger 192.168.1.10:50051

# Trigger sync with all peers
enx-sync trigger-all
```

## HTTP API Reference

### Endpoints

#### Health Check
```bash
curl http://localhost:8090/health
```

Response:
```json
{
  "status": "healthy"
}
```

#### Get Sync Status
```bash
curl http://localhost:8090/api/sync/status
```

Response:
```json
{
  "node_id": "desktop-001",
  "count": 2,
  "peers": [
    {
      "peer": "192.168.1.10:50051",
      "last_sync_time": 1767177008906
    }
  ]
}
```

#### Trigger Sync with Specific Peer
```bash
curl -X POST http://localhost:8090/api/sync/trigger \
  -H "Content-Type: application/json" \
  -d '{"peer": "192.168.1.10:50051"}'
```

Response:
```json
{
  "status": "triggered",
  "peer": "192.168.1.10:50051",
  "message": "Sync triggered successfully"
}
```

#### Trigger Sync with All Peers
```bash
curl -X POST http://localhost:8090/api/sync/trigger-all
```

Response:
```json
{
  "status": "triggered",
  "peers": ["192.168.1.10:50051", "192.168.1.20:50051"],
  "count": 2,
  "message": "Sync triggered for all peers"
}
```

## CLI Usage

### Commands

```bash
# Show help
enx-sync help

# Check service health
enx-sync health

# View sync status (last sync times)
enx-sync status

# Trigger sync with specific peer
enx-sync trigger <peer-address>
enx-sync trigger 192.168.1.10:50051

# Trigger sync with all configured peers
enx-sync trigger-all
```

### Output Formatting

Install `jq` for better JSON formatting:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

## Integration Examples

### Cron Job (Linux/macOS)

Sync every 30 minutes:
```bash
# Edit crontab
crontab -e

# Add line:
*/30 * * * * /path/to/enx-sync trigger-all
```

### Launchd (macOS)

Create `~/Library/LaunchAgents/com.enx.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.enx.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/enx-sync</string>
        <string>trigger-all</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

Load:
```bash
launchctl load ~/Library/LaunchAgents/com.enx.sync.plist
```

### Systemd Timer (Linux)

Create `/etc/systemd/system/enx-sync.service`:

```ini
[Unit]
Description=ENX Sync Service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/enx-sync trigger-all
```

Create `/etc/systemd/system/enx-sync.timer`:

```ini
[Unit]
Description=ENX Sync Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl enable enx-sync.timer
sudo systemctl start enx-sync.timer
```

## Testing

### Manual Test

Terminal 1 - Start server:
```bash
./bin/server --config config.yaml
```

Terminal 2 - Trigger sync:
```bash
enx-sync trigger localhost:50051
enx-sync status
```

### Integration Test with Multiple Nodes

1. Start Node 1 (Desktop):
```bash
./bin/server --config config-node1.yaml
```

2. Start Node 2 (MacBook):
```bash
./bin/server --config config-node2.yaml
```

3. Trigger bidirectional sync:
```bash
# On Node 1
enx-sync trigger 192.168.1.10:50051

# On Node 2
enx-sync trigger 192.168.1.1:50051
```

## Troubleshooting

### Check if service is running
```bash
curl http://localhost:8090/health
# or
enx-sync health
```

### View logs
```bash
# If running in foreground
tail -f /tmp/enx-server.log

# Check sync status
enx-sync status
```

### Test peer connectivity
```bash
nc -zv 192.168.1.10 50051
```

## Next Steps

- Phase 4: Production readiness (authentication, error handling, monitoring)
- Future: Auto-sync with periodic timers

## Phase 3 Completion Checklist

- ✅ HTTP API server implementation
- ✅ Configuration file support (YAML)
- ✅ CLI wrapper script
- ✅ Health check endpoint
- ✅ Sync status endpoint
- ✅ Trigger sync endpoints (single/all)
- ✅ Integration examples (cron, launchd, systemd)
- ✅ Documentation and usage guide

````
