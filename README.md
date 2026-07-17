# ENX - English Learning Tool

An English learning tool designed to train the human brain to recognize and understand English directly, without relying on translation.

## 🎯 Purpose

**The problem:** You're reading an English article in Chrome and encounter an unfamiliar word. The traditional workflow is tedious — copy the word, switch to a dictionary app, paste, look up the translation, then switch back to the article. Repeat dozens of times per article.

**ENX solves this** with a Chrome extension that shows an inline popup translation the moment you click any word on the page, without leaving the article.

Beyond instant lookup, ENX tracks how many times you've looked up each word, so you can see your vocabulary progress over time. Once you're confident about a word, you can mark it as learned. ENX also provides reading statistics to give you a picture of how your English reading ability is growing.

The longer-term goal: while AI translation is now widely available, ENX is built on the belief that it's still more effective for the human brain to recognize English directly — without the intermediate translation step. The lookup history and progress tracking are designed to help get you there.

## 📦 Project Structure

This is a monorepo containing multiple sub-projects:

| Project | Description | Technology |
|---------|-------------|------------|
| **[enx-api](enx-api/)** | Backend API server (Go) | Go, Gin, SQLite |
| **[enx-api-java](enx-api-java/)** | Backend API server (Java, dual-stack) | Java 26, Spring Boot 4.1, Gradle |
| **[enx-chrome](enx-chrome/)** | Chrome browser extension | TypeScript, React, Vite |
| **[enx-ui](enx-ui/)** | Web UI (future) | Next.js, React |
| **[enx-sync](enx-sync/)** | P2P data sync service | Go, gRPC |
| **[mock-api](mock-api/)** | Mock API server for testing | Node.js |

## 🚀 Quick Start

### Prerequisites

- Go (see [enx-api/go.mod](enx-api/go.mod))
- Java 26 + Gradle 9.6 (see [enx-api-java](enx-api-java/))
- Node.js 25+ (managed by fnm)
- pnpm
- SQLite 3

### Setup

```bash
# Install dependencies for all projects
task setup

# Start API server
task api:start

# Start Java API (port 8092, requires COGNITO_* env)
task java:run

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
