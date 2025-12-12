# Project Instructions for AI Agents

## Language Requirements

Use **English** for all code, comments, documentation, and configuration files to maintain consistency across the project.

## Code Conventions

- Follow existing code style and conventions in each sub-project
- Maintain consistency with existing patterns
- Test changes locally before committing
- Ensure proper `.gitignore` rules for generated files

## Documentation Guidelines

### Location

Place documentation files in the appropriate `docs/` directory:

| Project | Path | Content |
|---------|------|---------|
| enx-api | `enx-api/docs/` | API docs, deployment guides, architecture |
| enx-chrome | `enx-chrome/docs/` | Extension docs, user guides, development |
| enx-ui | `enx-ui/docs/` | UI docs, component guides, design |
| Root | `docs/` | Project-wide documentation |

Root-level markdown files (README.md, LICENSE, etc.) should only be used for project-wide documentation.

### Document Information Header

When creating or editing documentation files, include a "Document Information" table at the beginning:

```markdown
## Document Information

| Field | Value |
|-------|-------|
| **Created** | YYYY-MM-DD |
| **Last Updated** | YYYY-MM-DD |
| **Author** | author-name |
| **AI Assisted** | Yes/No (Tool Name) |
| **AI Model** | Model Name |
| **Status** | Draft/Proposed/Approved/Deprecated |
| **Version** | 0.1.0 |
```

## Project Structure

This is a monorepo with the following sub-projects:

- **enx-api** - Go backend API server (SQLite database)
- **enx-chrome** - Chrome extension (TypeScript, Vite)
- **enx-ui** - Next.js web UI
- **enx-data-service** - gRPC data service (Go)
- **mock-api** - Mock API server for testing

## Development Commands

Use Taskfile for consistent task execution:

```bash
# Root level
task dev-all      # Start all services
task test         # Run all unit tests
task test-all     # Run unit + integration tests

# Sub-projects
cd enx-api && task dev
cd enx-chrome && task dev
cd enx-ui && task dev
```

## Recording AI Contributions

When making significant contributions, update `AGENTS.md` with:

1. Date and task description
2. Problem statement
3. Solution overview
4. Files created/modified
5. Key benefits
