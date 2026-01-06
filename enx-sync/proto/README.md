# Shared Protocol Buffers Definitions

This directory contains the Protocol Buffer (protobuf) definitions shared across ENX services.

## Structure

```
proto/
├── data_service.proto    # Data service API definitions
├── generate.sh           # Code generation script
└── README.md            # This file
```

## Usage

### Generate gRPC Code

Run the generation script to generate Go code for all services:

```bash
cd proto
./generate.sh
```

This will generate:
- `enx-sync/proto/*.pb.go` - Server and client stubs
- `enx-api/proto/*.pb.go` - Client stubs

### Prerequisites

Install Protocol Buffer compiler and Go plugins:

```bash
# macOS
brew install protobuf

# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

## Services

### DataService (data_service.proto)

Provides CRUD operations and synchronization for the words table.

**Endpoints:**
- `GetWord` - Retrieve a single word by ID
- `CreateWord` - Create a new word
- `UpdateWord` - Update an existing word
- `DeleteWord` - Soft delete a word
- `ListWords` - List words with pagination
- `SyncWords` - Stream words modified since timestamp (for P2P sync)

## Best Practices

### 1. **Single Source of Truth**
- Proto files live only in this directory
- Services import generated code, never duplicate proto files

### 2. **Versioning**
- Use package versioning: `enx.data.v1`, `enx.data.v2`, etc.
- Breaking changes require new package version

### 3. **Backward Compatibility**
- Add new fields with new numbers
- Never remove or rename fields
- Use `reserved` for deprecated fields

### 4. **Code Generation**
- Always regenerate after proto changes: `./generate.sh`
- Commit generated code to version control
- Run generation in CI/CD pipeline

## Adding New Services

To add a new proto file:

1. Create `new_service.proto` in this directory
2. Update `generate.sh` to include the new file
3. Run `./generate.sh`
4. Import generated code in your services

## Proto Style Guide

Follow the [Google Protocol Buffers Style Guide](https://protobuf.dev/programming-guides/style/):

```protobuf
// ✅ Good
message WordRequest {
  string word_id = 1;      // snake_case fields
  int64 created_at = 2;
}

// ❌ Bad
message wordRequest {       // PascalCase for messages
  string wordId = 1;        // camelCase not recommended
}
```

## Troubleshooting

### `protoc: command not found`
Install protobuf compiler:
```bash
brew install protobuf  # macOS
apt install protobuf-compiler  # Ubuntu
```

### Import path issues
Ensure `--proto_path` points to this directory:
```bash
protoc --proto_path=proto ...
```

### Go package conflicts
Check `option go_package` in proto files matches your module structure.

## References

- [Protocol Buffers Documentation](https://protobuf.dev/)
- [gRPC Go Quick Start](https://grpc.io/docs/languages/go/quickstart/)
- [Buf Schema Registry](https://buf.build/) - Advanced proto management
