# ENX - English Learning Tool

An English learning tool designed to train the human brain to recognize and understand English directly, without relying on translation.

## 🎯 Purpose

While AI translation is now widely available, there are scenarios where it's more effective and convenient if the human brain can directly recognize English without the intermediate translation step.

## 📦 Project Structure

This is a monorepo containing multiple sub-projects:

| Project | Description | Technology |
|---------|-------------|------------|
| **[enx-api](enx-api/)** | Backend API server | Go, Gin, SQLite |
| **[enx-chrome](enx-chrome/)** | Chrome browser extension | TypeScript, React, Vite |
| **[enx-ui](enx-ui/)** | Web UI (future) | Next.js, React |
| **[enx-sync](enx-sync/)** | P2P data sync service | Go, gRPC |
| **[mock-api](mock-api/)** | Mock API server for testing | Node.js |

## 🚀 Quick Start

### Prerequisites

- Go 1.21+
- Node.js 25+ (managed by fnm)
- pnpm
- SQLite 3

### Setup

```bash
# Install dependencies for all projects
task setup

# Start API server
task api:start

# Start Chrome extension development
task dev-chrome
```

## Development Environment

### Load Unpacked Extension

Click the three dots at the far right of the Chrome address bar > Extensions > Manage Extensions

Load unpacked > Select the directory containing manifest.json

Pin the ENX extension

### Using the ENX Chrome Extension

The extension icon's badge displays OFF by default. Click the icon, the badge turns ON and triggers word highlighting. Currently supports InfoQ English version.
