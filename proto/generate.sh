#!/bin/bash
# Generate gRPC code for all services from shared proto files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$SCRIPT_DIR"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Generating gRPC code from proto files..."
echo "   Proto dir: $PROTO_DIR"
echo "   Root dir: $ROOT_DIR"
echo ""

# Generate for enx-data-service
echo "📦 Generating for enx-data-service..."
mkdir -p "$ROOT_DIR/enx-data-service/proto"
protoc --go_out="$ROOT_DIR/enx-data-service/proto" \
  --go_opt=paths=source_relative \
  --go-grpc_out="$ROOT_DIR/enx-data-service/proto" \
  --go-grpc_opt=paths=source_relative \
  --proto_path="$PROTO_DIR" \
  data_service.proto

# Generate for enx-api
echo "📦 Generating for enx-api..."
mkdir -p "$ROOT_DIR/enx-api/proto"
protoc --go_out="$ROOT_DIR/enx-api/proto" \
  --go_opt=paths=source_relative \
  --go-grpc_out="$ROOT_DIR/enx-api/proto" \
  --go-grpc_opt=paths=source_relative \
  --proto_path="$PROTO_DIR" \
  data_service.proto

echo ""
echo "✅ gRPC code generation completed!"
echo ""
echo "Generated files:"
find "$ROOT_DIR/enx-data-service/proto" "$ROOT_DIR/enx-api/proto" -name "*.pb.go" 2>/dev/null | sed 's|^|  - |'
