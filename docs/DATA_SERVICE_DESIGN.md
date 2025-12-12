# ENX Data Service Architecture Design

## Document Information

| Field | Value |
|-------|-------|
| **Created** | 2025-11-12 |
| **Last Updated** | 2025-11-12 (Added critical WAL sync warning) |
| **Author** | wiloon |
| **AI Assisted** | Yes (GitHub Copilot) |
| **AI Model** | Claude Sonnet 4.5 |
| **Version** | 1.1.0 |

## Overview

This document describes the architecture design for separating ENX into two services: **enx-api** (application layer) and **enx-data-service** (data layer with P2P sync capabilities).

## Problem Statement

### The Challenge

ENX is a **side project** with specific multi-environment development challenges:

1. **Long Development Cycle**: Development will continue over an extended period (months to years)
2. **Multiple Development Environments**:
   - **Desktop Linux**: Primary development environment
   - **MacBook**: Development + usage while traveling
   - **Ubuntu Laptop (Network Isolated)**: Development + usage in restricted network environment
3. **Active Usage During Development**: The application is actively used while being developed (common for side projects)
4. **Data Fragmentation Across Environments**: Different environments accumulate different data over time, requiring intelligent merging
5. **Offline-First Requirement**: Network-isolated environment must work without internet connection
6. **No Concurrent Access (Currently)**: Only one environment is used at any given time
   - **Current state**: No production environment yet, so no concurrent writes
   - **Future consideration**: If production environment is added, concurrent access may become a requirement
   - **Design implication**: Current design focuses on eventual consistency, not real-time multi-master sync

### Real-World Scenarios

**Scenario 1: Regular Switching**
```
Monday: Working on desktop Linux
  - Added 50 new words while reading technical articles

Friday: Taking a trip, using MacBook
  - Added 20 words while reading on the plane
  - Need access to Monday's 50 words ❌ (not synced)
```

**Scenario 2: Offline Development**
```
Weekend: Working in network-isolated Ubuntu environment
  - Cannot access cloud services
  - Added 30 words while working on isolated project
  - Modified learning progress on 15 words

Next week: Back on desktop Linux
  - Need to merge weekend's 30 words ❌ (isolated environment)
  - Need to sync progress updates ❌ (no connection)
```

**Scenario 3: Data Inconsistency**
```
Current state:
  - Desktop Linux: 1000 words, 500 marked as learned
  - MacBook: 950 words, 480 marked as learned
  - Ubuntu laptop (isolated): 920 words, 450 marked as learned

Problem: Which is the "correct" version?
Answer: All of them! Each has unique data that should be merged.
```

### Why This Design?

Given these challenges, the traditional solutions don't work:

❌ **Centralized Server**:
- Doesn't work in network-isolated environment
- Requires constant internet connection
- Single point of failure

❌ **Cloud File Sync (Dropbox/Google Drive)**:
- Delay in synchronization (2-10 seconds)
- Risk of file corruption with SQLite
- No intelligent conflict resolution
- Requires cloud sync client on all platforms

❌ **Manual Database Copy**:
- Error-prone
- Time-consuming
- No automatic conflict resolution
- Easy to forget

### The Solution: ENX Data Service

Since we need to solve the data synchronization problem anyway, why not:

1. **Wrap enx.db in a service** → enx-data-service
2. **Complete decoupling** → enx-api never touches the database directly
3. **Unified data access** → All database operations go through enx-data-service API
4. **Built-in synchronization** → enx-data-service handles node-to-node sync automatically

Benefits:

- ✅ **Development flexibility**: Develop on any environment, data stays in sync
- ✅ **Offline-first**: Work without network, sync when available
- ✅ **Data integrity**: Intelligent merge based on timestamps
- ✅ **Clean architecture**: Business logic completely separated from data management
- ✅ **Future-proof**: Easy to migrate from SQLite to PostgreSQL without touching enx-api
- ✅ **Service isolation**: enx-data-service can be restarted/upgraded independently

## Sync Requirements (New)

To support the P2P sync architecture, all synced tables must adhere to the following rules:

1.  **Primary Key**: Must be a **UUID** (String).
    *   *Reason*: Avoids ID conflicts between nodes (e.g., Node A and Node B both creating ID=100).
2.  **Timestamp Field**: Must have an `update_datetime` (or similar) field.
    *   *Reason*: Used to identify changed records since the last sync.
    *   *Note*: Clock skew is accepted as a risk for this project (single-user, OS time sync enabled).
3.  **Soft Delete**: Must have an `is_deleted` (boolean) or `deleted_at` (timestamp) field.
    *   *Reason*: Physical deletions cannot be synced. Soft deletes allow "deletion" events to propagate to other nodes.

## Implementation Strategy (Phase 1)

1.  **Scope**:
    *   Create `enx-data-service` in a new directory.
    *   Implement only the **"words"** table initially.
    *   Do NOT modify `enx-api` yet.
2.  **Integration**:
    *   Develop and test `enx-data-service` independently.
    *   Once `enx-data-service` is stable, refactor `enx-api` to connect to it.


## Architecture Goals

1. **Decoupling**: Separate business logic from data management
   - enx-api focuses on HTTP routing, authentication, business rules
   - enx-data-service focuses on data CRUD, sync, storage

2. **P2P Sync**: Enable data synchronization across multiple nodes without central server
   - Each node (Linux desktop, MacBook, Ubuntu laptop) runs its own enx-data-service
   - Nodes sync directly with each other (peer-to-peer)
   - No central server required (works in isolated environments)

3. **Offline Support**: Continue working when disconnected, sync when online
   - enx-data-service works locally even without network
   - Changes are queued and synced when connection is restored
   - No data loss in offline scenarios

4. **Scalability**: Easy to upgrade storage backend (SQLite → PostgreSQL) without changing enx-api
   - enx-api uses abstract data service API
   - Backend can be swapped without API changes
   - Future support for Redis caching, read replicas, etc.

5. **Flexibility**: Each service can be deployed, scaled, and upgraded independently
   - Update enx-api without touching data service
   - Upgrade database schema without restarting API
   - Run multiple enx-api instances against one data service

## System Architecture

```plantuml
@startuml ENX System Architecture

!define ICONURL https://raw.githubusercontent.com/tupadr3/plantuml-icon-font-sprites/v2.4.0

skinparam rectangle {
    BackgroundColor<<client>> LightBlue
    BackgroundColor<<api>> LightGreen
    BackgroundColor<<data>> LightYellow
    BackgroundColor<<db>> Wheat
}

skinparam component {
    BackgroundColor<<browser>> AliceBlue
    BackgroundColor<<service>> LightGreen
    BackgroundColor<<database>> Wheat
}

package "Client Layer" as ClientLayer {
    component "Browser\n+ Extension" as Browser1 <<browser>>
    component "Browser\n+ Extension" as Browser2 <<browser>>
    component "Browser\n+ Extension" as Browser3 <<browser>>
}

package "Application Layer" as AppLayer {
    component "enx-api\nHost A\nPort: 8090" as API_A <<service>>
    component "enx-api\nHost B\nPort: 8090" as API_B <<service>>
    component "enx-api\nHost C\nPort: 8090" as API_C <<service>>
}

package "Data Layer" as DataLayer {

    package "Host A" as HostA <<data>> {
        component "Data Service\nPort: 8091" as DS_A <<service>>
        database "enx.db\n(SQLite)" as DB_A <<database>>
        DS_A -down-> DB_A : SQL
    }

    package "Host B" as HostB <<data>> {
        component "Data Service\nPort: 8091" as DS_B <<service>>
        database "enx.db\n(SQLite)" as DB_B <<database>>
        DS_B -down-> DB_B : SQL
    }

    package "Host C" as HostC <<data>> {
        component "Data Service\nPort: 8091" as DS_C <<service>>
        database "enx.db\n(SQLite)" as DB_C <<database>>
        DS_C -down-> DB_C : SQL
    }
}

' Client to API connections
Browser1 -down-> API_A : HTTP/HTTPS
Browser2 -down-> API_B : HTTP/HTTPS
Browser3 -down-> API_C : HTTP/HTTPS

' API to Data Service connections
API_A -down-> DS_A : gRPC/HTTP
API_B -down-> DS_B : gRPC/HTTP
API_C -down-> DS_C : gRPC/HTTP

' P2P Sync connections between Data Services
DS_A <-right-> DS_B : P2P Sync\n(gRPC/HTTP)
DS_B <-right-> DS_C : P2P Sync\n(gRPC/HTTP)
DS_A <.down.> DS_C : P2P Sync\n(gRPC/HTTP)

note right of DataLayer
  **Key Points:**
  • Each Data Service directly accesses its local enx.db
  • Data Services sync with each other via gRPC/HTTP (P2P)
  • enx.db is embedded with Data Service (same process/host)
  • No central server required
end note

@enduml
```

## Communication Protocol Selection

### Chosen Solution: Hybrid Approach ⭐⭐⭐⭐⭐

**Strategy**:
- **gRPC for inter-service communication** (enx-api ↔ data-service, high frequency)
- **gRPC for node sync** (data-service ↔ data-service, P2P sync)
- **REST for admin/monitoring** (health checks, metrics)

**Benefits**:
- Best performance for critical paths
- Easy debugging and monitoring
- Flexibility for different use cases

```
enx-api → gRPC → enx-data-service  (Fast, typed)
    ↓
User/Admin → REST → enx-api       (Easy debugging)

data-service → gRPC → data-service  (Efficient sync)
```

## Communication Patterns

### 1. Request-Response (Synchronous)

**Use Case**: CRUD operations, immediate response needed

#### ❌ **ENX-Specific API (Old Design - Not for generic service)**

```go
// ❌ This won't work with generic data service
// Reason: GetWord() is ENX-specific, not generic
word, err := dataClient.GetWord(ctx, &pb.GetWordRequest{
    English: "hello",
})
```

#### ✅ **Generic Data Service API (New Design - Recommended)**

**Scenario: Query a single word by English**

**Method 1: Structured API (Find) - ⭐ Recommended for simple queries**

```go
// enx-api queries word using generic Find() API
resp, err := dataClient.Find(ctx, &pb.FindRequest{
    Table: "words",
    Filter: `{"english": "hello"}`,  // JSON filter
    Limit: 1,                         // Only need one result
})

if err != nil {
    return nil, fmt.Errorf("failed to query word: %w", err)
}

if len(resp.Rows) == 0 {
    return nil, ErrWordNotFound
}

// Parse result row
row := resp.Rows[0]
word := &Word{
    English: row.Cells[0].GetStringValue(),  // Column: english
    Chinese: row.Cells[1].GetStringValue(),  // Column: chinese
    // ... other fields
}
```

**Method 2: Raw SQL (Query) - For complex queries**

```go
// Using parameterized SQL query
resp, err := dataClient.Query(ctx, &pb.QueryRequest{
    Sql: "SELECT english, chinese, phonetic, definition FROM words WHERE english = ?",
    Params: []*pb.QueryParam{
        {Value: &pb.QueryParam_StringValue{StringValue: "hello"}},
    },
})

if err != nil {
    return nil, fmt.Errorf("failed to query word: %w", err)
}

// Parse result (same as Method 1)
```

**Method 3: Complex query with JOIN (user's learning progress)**

```go
// Query word with user's learning status
// ENX-specific: JOIN words table with user_dicts table
resp, err := dataClient.Query(ctx, &pb.QueryRequest{
    Sql: `
        SELECT w.english, w.chinese, w.phonetic, w.definition,
               ud.learned, ud.update_time
        FROM words w
        LEFT JOIN user_dicts ud ON w.english = ud.english AND ud.user_id = ?
        WHERE w.english = ?
    `,
    Params: []*pb.QueryParam{
        {Value: &pb.QueryParam_IntValue{IntValue: userID}},      // User ID
        {Value: &pb.QueryParam_StringValue{StringValue: "hello"}}, // Word
    },
})

// Result includes both word info and learning status
```

**Comparison:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Method          │ Use Case              │ Pros              │ Cons           │
├─────────────────┼───────────────────────┼───────────────────┼────────────────┤
│ Find() JSON     │ Simple queries        │ ✅ Type-safe      │ ⚠️ JSON parsing │
│                 │ Single table          │ ✅ SQL-injection  │                │
│                 │ Basic filters         │    safe           │                │
├─────────────────┼───────────────────────┼───────────────────┼────────────────┤
│ Query() Simple  │ Single table          │ ✅ Familiar SQL   │ ⚠️ Need SQL    │
│                 │ Exact SQL control     │ ✅ Flexible       │    knowledge   │
├─────────────────┼───────────────────────┼───────────────────┼────────────────┤
│ Query() JOIN    │ Multi-table queries   │ ✅ Full SQL power │ ⚠️ More complex│
│                 │ Aggregations          │ ✅ Efficient      │                │
│                 │ Complex logic         │                   │                │
└─────────────────────────────────────────────────────────────────┘

Recommendation for ENX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Simple word lookup:        Use Find() (Method 1)
• Word + learning status:    Use Query() with JOIN (Method 3)
• Batch operations:          Use BatchExecute()
• Search/filter words:       Use Find() with complex JSON filter
```

**Real-World Example: ENX API Handler**

```go
// enx-api/handlers/word.go

package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/gin-gonic/gin"
    pb "enx/proto"  // Generic data service proto
)

type WordHandler struct {
    dataClient pb.GenericDataServiceClient
}

// GET /api/words/:english
func (h *WordHandler) GetWord(c *gin.Context) {
    english := c.Param("english")
    userID := c.GetInt64("user_id")  // From JWT token

    // Query word with user's learning progress (Method 3)
    resp, err := h.dataClient.Query(c.Request.Context(), &pb.QueryRequest{
        Sql: `
            SELECT
                w.english, w.chinese, w.phonetic, w.definition,
                w.update_datetime,
                COALESCE(ud.learned, 0) as learned,
                ud.update_time as user_update_time
            FROM words w
            LEFT JOIN user_dicts ud ON w.english = ud.english AND ud.user_id = ?
            WHERE w.english = ?
        `,
        Params: []*pb.QueryParam{
            {Value: &pb.QueryParam_IntValue{IntValue: userID}},
            {Value: &pb.QueryParam_StringValue{StringValue: english}},
        },
    })

    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    if len(resp.Rows) == 0 {
        c.JSON(http.StatusNotFound, gin.H{"error": "word not found"})
        return
    }

    // Parse result row into Word struct
    row := resp.Rows[0]
    word := map[string]interface{}{
        "english":      row.Cells[0].GetStringValue(),
        "chinese":      row.Cells[1].GetStringValue(),
        "phonetic":     row.Cells[2].GetStringValue(),
        "definition":   row.Cells[3].GetStringValue(),
        "update_datetime": row.Cells[4].GetStringValue(),
        "learned":      row.Cells[5].GetIntValue() == 1,
        "user_update_time": row.Cells[6].GetStringValue(),
    }

    c.JSON(http.StatusOK, word)
}

// POST /api/words/search (search multiple words)
func (h *WordHandler) SearchWords(c *gin.Context) {
    var req struct {
        Query  string `json:"query"`  // Search term
        Limit  int32  `json:"limit"`
        Offset int32  `json:"offset"`
    }

    if err := c.BindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    // Use Find() API for simple search (Method 1)
    filter := map[string]interface{}{
        "english": map[string]interface{}{
            "$like": req.Query + "%",  // Prefix search
        },
    }
    filterJSON, _ := json.Marshal(filter)

    resp, err := h.dataClient.Find(c.Request.Context(), &pb.FindRequest{
        Table:  "words",
        Filter: string(filterJSON),
        Sort:   `{"english": 1}`,  // Sort alphabetically
        Limit:  req.Limit,
        Offset: req.Offset,
    })

    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    // Convert rows to words array
    words := make([]map[string]interface{}, 0, len(resp.Rows))
    for _, row := range resp.Rows {
        words = append(words, map[string]interface{}{
            "english": row.Cells[0].GetStringValue(),
            "chinese": row.Cells[1].GetStringValue(),
            // ... other fields
        })
    }

    c.JSON(http.StatusOK, gin.H{
        "words": words,
        "total": len(words),
    })
}
```

**Key Takeaways:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Migration from ENX-specific to Generic Data Service:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before (ENX-specific):
  dataClient.GetWord(ctx, &pb.GetWordRequest{English: "hello"})
  ↓
  • Hardcoded GetWord() method
  • Only works with words table
  • Not reusable for other projects

After (Generic):
  dataClient.Find(ctx, &pb.FindRequest{
      Table: "words",
      Filter: `{"english": "hello"}`,
  })
  ↓
  • Generic Find() method
  • Works with ANY table (words, users, posts, etc.)
  • Configuration-driven
  • Reusable across projects

Trade-offs:
  ✅ Gain: Flexibility, reusability, open-source potential
  ⚠️ Lose: Compile-time type safety for specific tables
  ⚠️ Need: Runtime JSON parsing, manual column mapping

Worth it?
  ✅ YES - If goal is generic open-source tool
  ❌ NO  - If only need ENX-specific service
```

**Characteristics**:
- Blocking call
- Timeout handling required
- Suitable for: Word lookup, search, CRUD operations

### 2. Streaming (Asynchronous)

**Use Case**: Large data transfer, real-time sync

```go
// Client streaming (enx-api → data-service)
stream, err := client.BatchCreateWords(ctx)
for _, word := range words {
    stream.Send(word)
}
response, err := stream.CloseAndRecv()

// Server streaming (data-service → enx-api)
stream, err := client.GetChanges(ctx, &pb.GetChangesRequest{
    Since: lastSyncTime,
})
for {
    change, err := stream.Recv()
    if err == io.EOF {
        break
    }
    applyChange(change)
}

// Bidirectional streaming (node-to-node sync)
stream, err := client.SyncNodes(ctx)
go func() {
    for {
        change := <-localChanges
        stream.Send(change)
    }
}()
for {
    change, err := stream.Recv()
    applyChange(change)
}
```

**Characteristics**:
- Non-blocking
- Efficient for large datasets
- Suitable for: Sync operations, batch operations

### 3. Event-Driven (Pub/Sub)

**Use Case**: Notify other nodes of changes (future enhancement)

```go
// Option: Add Redis Pub/Sub for change notifications
pubsub := redis.PubSub()
pubsub.Subscribe("enx:changes")

for msg := range pubsub.Channel() {
    // Node publishes: "word:123:updated"
    // Other nodes receive and pull changes
}
```

**Characteristics**:
- Decoupled
- Scalable
- Suitable for: Real-time notifications, event sourcing

## Protocol Comparison Matrix

| Feature              | gRPC         | REST/HTTP    | Hybrid       |
|---------------------|--------------|--------------|--------------|
| Performance         | ⭐⭐⭐⭐⭐     | ⭐⭐⭐        | ⭐⭐⭐⭐⭐     |
| Type Safety         | ⭐⭐⭐⭐⭐     | ⭐⭐          | ⭐⭐⭐⭐⭐     |
| Ease of Debugging   | ⭐⭐⭐        | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐      |
| Learning Curve      | ⭐⭐⭐        | ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐      |
| Streaming Support   | ⭐⭐⭐⭐⭐     | ⭐⭐          | ⭐⭐⭐⭐⭐     |
| Browser Support     | ⭐⭐ (grpc-web)| ⭐⭐⭐⭐⭐     | ⭐⭐⭐⭐⭐     |
| Payload Size        | Small        | Large        | Optimal      |
| Setup Complexity    | Medium       | Low          | Medium       |

## Service Interfaces

### enx-data-service API

#### Data API (gRPC)

```protobuf
service DataService {
  // Words
  rpc GetWord(GetWordRequest) returns (Word);
  rpc CreateWord(CreateWordRequest) returns (Word);
  rpc UpdateWord(UpdateWordRequest) returns (Word);
  rpc DeleteWord(DeleteWordRequest) returns (Empty);
  rpc SearchWords(SearchWordsRequest) returns (SearchWordsResponse);

  // User Dicts
  rpc GetUserWords(GetUserWordsRequest) returns (GetUserWordsResponse);
  rpc MarkWord(MarkWordRequest) returns (MarkWordResponse);
  rpc GetUserStats(GetUserStatsRequest) returns (UserStats);

  // Users
  rpc GetUser(GetUserRequest) returns (User);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc ValidateUser(ValidateUserRequest) returns (ValidateUserResponse);
}
```

#### Sync API (gRPC)

```protobuf
service SyncService {
  // Node management
  rpc RegisterNode(RegisterNodeRequest) returns (Node);
  rpc GetNodes(GetNodesRequest) returns (GetNodesResponse);
  rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);

  // Data sync
  rpc GetChanges(GetChangesRequest) returns (stream Change);
  rpc PushChanges(stream Change) returns (PushChangesResponse);
  rpc GetSnapshot(GetSnapshotRequest) returns (stream SnapshotChunk);

  // Conflict resolution
  rpc ResolveConflict(ResolveConflictRequest) returns (ResolveConflictResponse);
}
```

#### Admin API (REST)

```http
# Health and status
GET  /health
GET  /metrics
GET  /nodes
GET  /sync/status

# Manual operations
POST /sync/trigger
POST /sync/full-sync
GET  /sync/conflicts
```

## Data Flow Examples

### Example 1: User Marks a Word

```
┌─────────┐         ┌─────────┐         ┌──────────────┐
│ Browser │         │ enx-api │         │ data-service │
└────┬────┘         └────┬────┘         └──────┬───────┘
     │                   │                      │
     │ POST /mark        │                      │
     ├──────────────────>│                      │
     │                   │ MarkWord(gRPC)       │
     │                   ├─────────────────────>│
     │                   │                      │
     │                   │                      │ Update DB
     │                   │                      │ Record Change
     │                   │                      │
     │                   │ Response             │
     │                   │<─────────────────────┤
     │ 200 OK            │                      │
     │<──────────────────┤                      │
     │                   │                      │
```

### Example 2: Automatic P2P Sync

```
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│ data-service A │         │ data-service B │         │ data-service C │
└───────┬────────┘         └───────┬────────┘         └───────┬────────┘
        │                          │                          │
        │ [5 min timer]            │                          │
        │                          │                          │
        │ GetChanges(since=10:00)  │                          │
        ├─────────────────────────>│                          │
        │                          │                          │
        │ Stream changes           │                          │
        │<─────────────────────────┤                          │
        │ Apply changes            │                          │
        │                          │                          │
        │ PushChanges              │                          │
        ├─────────────────────────>│                          │
        │                          │ Apply changes            │
        │                          │                          │
        │                          │ GetChanges               │
        │                          ├─────────────────────────>│
        │                          │                          │ (offline)
        │                          │ Connection timeout       │
        │                          │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
        │                          │                          │
```

### Example 3: Offline Node Recovery

```
┌────────────────┐         ┌────────────────┐
│ data-service C │         │ data-service A │
│   (offline)    │         │   (online)     │
└───────┬────────┘         └───────┬────────┘
        │                          │
        │ [comes online]           │
        │                          │
        │ RegisterNode             │
        ├─────────────────────────>│
        │                          │
        │ Node info + last_sync    │
        │<─────────────────────────┤
        │                          │
        │ GetSnapshot(full=true)   │
        ├─────────────────────────>│
        │                          │
        │ Stream all changes       │
        │ since last_sync          │
        │<═════════════════════════┤
        │ Apply changes            │
        │                          │
        │ PushChanges              │
        │ (local changes)          │
        ├═════════════════════════>│
        │                          │
        │ Ack + new last_sync      │
        │<─────────────────────────┤
        │                          │
        │ ✅ Fully synced          │
```

## Error Handling

### Connection Errors

```go
// Retry with exponential backoff
func (c *DataClient) GetWordWithRetry(word string) (*Word, error) {
    backoff := time.Second
    maxRetries := 3

    for i := 0; i < maxRetries; i++ {
        word, err := c.GetWord(word)
        if err == nil {
            return word, nil
        }

        if isNetworkError(err) {
            time.Sleep(backoff)
            backoff *= 2
            continue
        }

        return nil, err
    }

    return nil, ErrMaxRetriesExceeded
}
```

### Timeout Handling

```go
// Set appropriate timeouts
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

word, err := client.GetWord(ctx, req)
if err == context.DeadlineExceeded {
    // Handle timeout
    log.Warn("Request timeout, using cached data")
    return getCachedWord(req.English)
}
```

### Circuit Breaker Pattern

```go
// Prevent cascading failures
type CircuitBreaker struct {
    maxFailures int
    timeout     time.Duration
    failures    int
    lastFail    time.Time
    state       State  // Closed, Open, HalfOpen
}

func (cb *CircuitBreaker) Call(fn func() error) error {
    if cb.state == Open {
        if time.Since(cb.lastFail) > cb.timeout {
            cb.state = HalfOpen
        } else {
            return ErrCircuitOpen
        }
    }

    err := fn()
    if err != nil {
        cb.failures++
        cb.lastFail = time.Now()
        if cb.failures >= cb.maxFailures {
            cb.state = Open
        }
        return err
    }

    cb.failures = 0
    cb.state = Closed
    return nil
}
```

## Performance Considerations

### Connection Pooling

```go
// Reuse gRPC connections
var (
    connPool = make(map[string]*grpc.ClientConn)
    poolMux  sync.RWMutex
)

func GetConnection(addr string) (*grpc.ClientConn, error) {
    poolMux.RLock()
    if conn, exists := connPool[addr]; exists {
        poolMux.RUnlock()
        return conn, nil
    }
    poolMux.RUnlock()

    poolMux.Lock()
    defer poolMux.Unlock()

    conn, err := grpc.Dial(addr, grpc.WithInsecure())
    if err != nil {
        return nil, err
    }

    connPool[addr] = conn
    return conn, nil
}
```

### Request Batching

```go
// Batch multiple operations
type BatchRequest struct {
    Operations []Operation
}

func (c *DataClient) BatchExecute(ops []Operation) error {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    stream, err := c.client.BatchExecute(ctx)
    if err != nil {
        return err
    }

    for _, op := range ops {
        if err := stream.Send(op); err != nil {
            return err
        }
    }

    resp, err := stream.CloseAndRecv()
    return err
}
```

### Caching Strategy

```go
// Cache frequently accessed data
type CachedDataClient struct {
    client DataServiceClient
    cache  *lru.Cache
    ttl    time.Duration
}

func (c *CachedDataClient) GetWord(word string) (*Word, error) {
    // Check cache first
    if val, ok := c.cache.Get(word); ok {
        if entry := val.(*CacheEntry); time.Since(entry.Time) < c.ttl {
            return entry.Word, nil
        }
    }

    // Cache miss, fetch from service
    result, err := c.client.GetWord(context.Background(), &pb.GetWordRequest{
        English: word,
    })
    if err != nil {
        return nil, err
    }

    // Update cache
    c.cache.Add(word, &CacheEntry{
        Word: result,
        Time: time.Now(),
    })

    return result, nil
}
```

## Security Considerations

### gRPC Authentication Methods

**✅ Yes! gRPC fully supports authentication, just like RESTful APIs**

gRPC supports multiple authentication methods:

#### 1. **Token-Based Authentication (JWT)** ⭐ Recommended

**Most common approach, similar to HTTP Bearer Token**

```go
// ==================== Server Side ====================

package main

import (
    "context"
    "fmt"
    "time"

    "github.com/golang-jwt/jwt/v4"
    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

// JWT Claims
type Claims struct {
    UserID   int64  `json:"user_id"`
    Username string `json:"username"`
    jwt.StandardClaims
}

// Auth Interceptor
type AuthInterceptor struct {
    jwtSecret []byte
}

// Unary interceptor for JWT validation
func (a *AuthInterceptor) Unary() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
                handler grpc.UnaryHandler) (interface{}, error) {

        // Skip authentication for public endpoints
        if isPublicMethod(info.FullMethod) {
            return handler(ctx, req)
        }

        // Extract metadata
        md, ok := metadata.FromIncomingContext(ctx)
        if !ok {
            return nil, status.Error(codes.Unauthenticated, "missing metadata")
        }

        // Get authorization token
        tokens := md.Get("authorization")
        if len(tokens) == 0 {
            return nil, status.Error(codes.Unauthenticated, "missing authorization token")
        }

        // Validate token
        claims, err := a.validateToken(tokens[0])
        if err != nil {
            return nil, status.Error(codes.Unauthenticated, fmt.Sprintf("invalid token: %v", err))
        }

        // Add user info to context
        ctx = context.WithValue(ctx, "user_id", claims.UserID)
        ctx = context.WithValue(ctx, "username", claims.Username)

        return handler(ctx, req)
    }
}

// Validate JWT token
func (a *AuthInterceptor) validateToken(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return a.jwtSecret, nil
    })

    if err != nil {
        return nil, err
    }

    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        return claims, nil
    }

    return nil, fmt.Errorf("invalid token")
}

// Public methods that don't require authentication
func isPublicMethod(method string) bool {
    publicMethods := map[string]bool{
        "/enx.data.DataService/HealthCheck": true,
        "/enx.data.AuthService/Login":       true,
        "/enx.data.AuthService/Register":    true,
    }
    return publicMethods[method]
}

// Create gRPC server with authentication
func NewAuthenticatedServer(jwtSecret string) *grpc.Server {
    authInterceptor := &AuthInterceptor{
        jwtSecret: []byte(jwtSecret),
    }

    server := grpc.NewServer(
        grpc.UnaryInterceptor(authInterceptor.Unary()),
    )

    return server
}

// ==================== Client Side ====================

// Client with JWT token
type AuthClient struct {
    conn  *grpc.ClientConn
    token string
}

// Create authenticated client
func NewAuthClient(addr, token string) (*AuthClient, error) {
    conn, err := grpc.Dial(addr,
        grpc.WithInsecure(),
        grpc.WithUnaryInterceptor(tokenInterceptor(token)),
    )
    if err != nil {
        return nil, err
    }

    return &AuthClient{
        conn:  conn,
        token: token,
    }, nil
}

// Client interceptor to add token to requests
func tokenInterceptor(token string) grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply interface{},
                cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {

        // Add token to metadata
        ctx = metadata.AppendToOutgoingContext(ctx, "authorization", token)

        return invoker(ctx, method, req, reply, cc, opts...)
    }
}

// Example: Login to get token
func Login(client AuthServiceClient, username, password string) (string, error) {
    ctx := context.Background()

    resp, err := client.Login(ctx, &LoginRequest{
        Username: username,
        Password: password,
    })
    if err != nil {
        return "", err
    }

    return resp.Token, nil
}

// Generate JWT token (server-side)
func GenerateToken(userID int64, username string, secret []byte, duration time.Duration) (string, error) {
    claims := &Claims{
        UserID:   userID,
        Username: username,
        StandardClaims: jwt.StandardClaims{
            ExpiresAt: time.Now().Add(duration).Unix(),
            IssuedAt:  time.Now().Unix(),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(secret)
}
```

#### 2. **Basic Authentication (Username/Password)**

**Simple username/password authentication**

```go
// ==================== Server Side ====================

type BasicAuthInterceptor struct {
    users map[string]string // username -> password hash
}

func (b *BasicAuthInterceptor) Unary() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
                handler grpc.UnaryHandler) (interface{}, error) {

        md, ok := metadata.FromIncomingContext(ctx)
        if !ok {
            return nil, status.Error(codes.Unauthenticated, "missing credentials")
        }

        // Get username and password
        usernames := md.Get("username")
        passwords := md.Get("password")

        if len(usernames) == 0 || len(passwords) == 0 {
            return nil, status.Error(codes.Unauthenticated, "missing username or password")
        }

        // Validate credentials
        if !b.validateCredentials(usernames[0], passwords[0]) {
            return nil, status.Error(codes.Unauthenticated, "invalid credentials")
        }

        ctx = context.WithValue(ctx, "username", usernames[0])
        return handler(ctx, req)
    }
}

func (b *BasicAuthInterceptor) validateCredentials(username, password string) bool {
    expectedHash, exists := b.users[username]
    if !exists {
        return false
    }

    // Compare password hash (use bcrypt in production)
    return comparePasswordHash(password, expectedHash)
}

// ==================== Client Side ====================

type BasicAuthClient struct {
    conn     *grpc.ClientConn
    username string
    password string
}

func basicAuthInterceptor(username, password string) grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply interface{},
                cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {

        // Add credentials to metadata
        ctx = metadata.AppendToOutgoingContext(ctx,
            "username", username,
            "password", password,
        )

        return invoker(ctx, method, req, reply, cc, opts...)
    }
}

func NewBasicAuthClient(addr, username, password string) (*BasicAuthClient, error) {
    conn, err := grpc.Dial(addr,
        grpc.WithInsecure(),
        grpc.WithUnaryInterceptor(basicAuthInterceptor(username, password)),
    )
    if err != nil {
        return nil, err
    }

    return &BasicAuthClient{
        conn:     conn,
        username: username,
        password: password,
    }, nil
}
```

#### 3. **API Key Authentication**

**Authentication using API Keys**

```go
// ==================== Server Side ====================

type APIKeyInterceptor struct {
    validKeys map[string]string // apiKey -> userID
}

func (a *APIKeyInterceptor) Unary() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
                handler grpc.UnaryHandler) (interface{}, error) {

        md, ok := metadata.FromIncomingContext(ctx)
        if !ok {
            return nil, status.Error(codes.Unauthenticated, "missing metadata")
        }

        // Get API key
        keys := md.Get("x-api-key")
        if len(keys) == 0 {
            return nil, status.Error(codes.Unauthenticated, "missing API key")
        }

        // Validate API key
        userID, valid := a.validKeys[keys[0]]
        if !valid {
            return nil, status.Error(codes.Unauthenticated, "invalid API key")
        }

        ctx = context.WithValue(ctx, "user_id", userID)
        return handler(ctx, req)
    }
}

// ==================== Client Side ====================

func apiKeyInterceptor(apiKey string) grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply interface{},
                cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {

        ctx = metadata.AppendToOutgoingContext(ctx, "x-api-key", apiKey)
        return invoker(ctx, method, req, reply, cc, opts...)
    }
}
```

#### 4. **OAuth2 / OpenID Connect**

**Enterprise-grade authentication solution**

```go
import (
    "golang.org/x/oauth2"
    "google.golang.org/grpc/credentials/oauth"
)

// Client with OAuth2
func NewOAuth2Client(addr, accessToken string) (*grpc.ClientConn, error) {
    perRPC := oauth.NewOauthAccess(&oauth2.Token{
        AccessToken: accessToken,
    })

    return grpc.Dial(addr,
        grpc.WithPerRPCCredentials(perRPC),
        grpc.WithTransportCredentials(insecure.NewCredentials()),
    )
}
```

#### 5. **Mutual TLS (mTLS)**

**Bidirectional certificate authentication between client and server**

```go
// ==================== Server Side ====================

import (
    "crypto/tls"
    "crypto/x509"
    "io/ioutil"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials"
)

func NewMTLSServer(certFile, keyFile, caFile string) (*grpc.Server, error) {
    // Load server certificate
    cert, err := tls.LoadX509KeyPair(certFile, keyFile)
    if err != nil {
        return nil, err
    }

    // Load CA certificate
    caCert, err := ioutil.ReadFile(caFile)
    if err != nil {
        return nil, err
    }

    caPool := x509.NewCertPool()
    caPool.AppendCertsFromPEM(caCert)

    // Configure TLS
    tlsConfig := &tls.Config{
        Certificates: []tls.Certificate{cert},
        ClientAuth:   tls.RequireAndVerifyClientCert,
        ClientCAs:    caPool,
    }

    creds := credentials.NewTLS(tlsConfig)
    server := grpc.NewServer(grpc.Creds(creds))

    return server, nil
}

// ==================== Client Side ====================

func NewMTLSClient(addr, certFile, keyFile, caFile string) (*grpc.ClientConn, error) {
    // Load client certificate
    cert, err := tls.LoadX509KeyPair(certFile, keyFile)
    if err != nil {
        return nil, err
    }

    // Load CA certificate
    caCert, err := ioutil.ReadFile(caFile)
    if err != nil {
        return nil, err
    }

    caPool := x509.NewCertPool()
    caPool.AppendCertsFromPEM(caCert)

    tlsConfig := &tls.Config{
        Certificates: []tls.Certificate{cert},
        RootCAs:      caPool,
    }

    creds := credentials.NewTLS(tlsConfig)
    return grpc.Dial(addr, grpc.WithTransportCredentials(creds))
}
```

### Complete Authentication Example for ENX

**Complete authentication example for ENX project**

```go
package main

import (
    "context"
    "log"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

// ==================== Server Setup ====================

func main() {
    // JWT secret (should be in config)
    jwtSecret := "your-secret-key-here"

    // Create authenticated server
    authInterceptor := &AuthInterceptor{
        jwtSecret: []byte(jwtSecret),
    }

    server := grpc.NewServer(
        grpc.ChainUnaryInterceptor(
            authInterceptor.Unary(),        // Authentication
            loggingInterceptor(),           // Logging
            rateLimitInterceptor(),         // Rate limiting
        ),
    )

    // Register services
    pb.RegisterDataServiceServer(server, &dataServiceImpl{})
    pb.RegisterAuthServiceServer(server, &authServiceImpl{
        jwtSecret: []byte(jwtSecret),
    })

    // Start server
    lis, _ := net.Listen("tcp", ":8091")
    log.Println("🚀 Data Service running on :8091 with authentication")
    server.Serve(lis)
}

// ==================== Auth Service Implementation ====================

type authServiceImpl struct {
    pb.UnimplementedAuthServiceServer
    jwtSecret []byte
}

func (s *authServiceImpl) Login(ctx context.Context, req *pb.LoginRequest) (*pb.LoginResponse, error) {
    // Validate credentials (check database)
    user, err := validateCredentials(req.Username, req.Password)
    if err != nil {
        return nil, status.Error(codes.Unauthenticated, "invalid credentials")
    }

    // Generate JWT token
    token, err := GenerateToken(user.ID, user.Username, s.jwtSecret, 24*time.Hour)
    if err != nil {
        return nil, status.Error(codes.Internal, "failed to generate token")
    }

    return &pb.LoginResponse{
        Token:  token,
        UserID: user.ID,
    }, nil
}

// ==================== Client Usage ====================

func ExampleAuthenticatedClient() {
    // Step 1: Login to get token
    conn, _ := grpc.Dial("localhost:8091", grpc.WithInsecure())
    authClient := pb.NewAuthServiceClient(conn)

    loginResp, err := authClient.Login(context.Background(), &pb.LoginRequest{
        Username: "wiloon",
        Password: "haCahpro",
    })
    if err != nil {
        log.Fatal("Login failed:", err)
    }

    token := loginResp.Token
    log.Println("✅ Logged in, token:", token)

    // Step 2: Use token for authenticated requests
    authConn, _ := grpc.Dial("localhost:8091",
        grpc.WithInsecure(),
        grpc.WithUnaryInterceptor(tokenInterceptor(token)),
    )

    dataClient := pb.NewDataServiceClient(authConn)

    // Now all requests include authentication token
    word, err := dataClient.GetWord(context.Background(), &pb.GetWordRequest{
        English: "hello",
    })
    if err != nil {
        log.Fatal("GetWord failed:", err)
    }

    log.Println("✅ Got word:", word)
}
```

### Authentication Comparison

| Method | Complexity | Security | Use Case |
|--------|-----------|----------|----------|
| **JWT Token** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **Recommended** - Modern APIs, stateless |
| **Basic Auth** | ⭐ | ⭐⭐⭐ | Simple internal services |
| **API Key** | ⭐⭐ | ⭐⭐⭐⭐ | Service-to-service |
| **OAuth2** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Enterprise, third-party |
| **mTLS** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | High security, internal |

### Recommended for ENX Project

**Recommended approach: JWT Token Authentication**

```
Why JWT for ENX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Stateless: No session storage needed
✅ Self-contained: Token includes user info
✅ Expiration: Built-in token expiry
✅ Familiar: Same as HTTP REST APIs
✅ Easy to implement: Standard JWT libraries
✅ Secure: HMAC-SHA256 signature

Workflow:
1. User logs in → Get JWT token
2. Include token in gRPC metadata
3. Server validates token on each request
4. Token expires after 24 hours
5. Refresh token when needed
```

### TLS/SSL

```go
// Enable TLS for production
creds, err := credentials.NewServerTLSFromFile("server.crt", "server.key")
if err != nil {
    log.Fatal(err)
}

server := grpc.NewServer(grpc.Creds(creds))
```

### Rate Limiting

```go
// Prevent abuse
type RateLimiter struct {
    limiter *rate.Limiter
}

func (r *RateLimiter) Intercept(ctx context.Context, req interface{},
                                 info *grpc.UnaryServerInfo,
                                 handler grpc.UnaryHandler) (interface{}, error) {
    if !r.limiter.Allow() {
        return nil, status.Error(codes.ResourceExhausted, "rate limit exceeded")
    }
    return handler(ctx, req)
}
```

## Monitoring and Observability

### Metrics

```go
// Prometheus metrics
var (
    requestDuration = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "enx_data_service_request_duration_seconds",
            Help: "Request duration in seconds",
        },
        []string{"method", "status"},
    )

    syncOperations = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "enx_data_service_sync_operations_total",
            Help: "Total number of sync operations",
        },
        []string{"type", "node"},
    )
)

// Instrument RPC calls
func instrumentedHandler(ctx context.Context, req interface{}) (interface{}, error) {
    start := time.Now()
    resp, err := originalHandler(ctx, req)
    duration := time.Since(start).Seconds()

    status := "success"
    if err != nil {
        status = "error"
    }

    requestDuration.WithLabelValues(method, status).Observe(duration)
    return resp, err
}
```

### Logging

```go
// Structured logging
func LoggingInterceptor() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
                handler grpc.UnaryHandler) (interface{}, error) {
        start := time.Now()

        log.WithFields(log.Fields{
            "method": info.FullMethod,
            "request": req,
        }).Info("RPC started")

        resp, err := handler(ctx, req)

        log.WithFields(log.Fields{
            "method": info.FullMethod,
            "duration": time.Since(start),
            "error": err,
        }).Info("RPC completed")

        return resp, err
    }
}
```

### Tracing

```go
// OpenTelemetry tracing
import "go.opentelemetry.io/otel"

func TracingInterceptor() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo,
                handler grpc.UnaryHandler) (interface{}, error) {
        tracer := otel.Tracer("enx-data-service")
        ctx, span := tracer.Start(ctx, info.FullMethod)
        defer span.End()

        resp, err := handler(ctx, req)
        if err != nil {
            span.RecordError(err)
        }

        return resp, err
    }
}
```

## SQLite WAL (Write-Ahead Logging) Deep Dive

### What is WAL?

**WAL (Write-Ahead Logging)** is an alternative journaling mode in SQLite that provides better concurrency and performance compared to the traditional rollback journal.

**Official Documentation**: https://www.sqlite.org/wal.html

### Core Concept

In WAL mode, changes are written to a separate **WAL file** before being applied to the main database:

```
Traditional Mode (Rollback Journal):
┌──────────┐
│ enx.db   │ ← Direct write (locks entire file)
└──────────┘
│ Rollback │ ← Backup for crash recovery
│ Journal  │
└──────────┘

WAL Mode:
┌──────────┐
│ enx.db   │ ← Main database (readers read here)
└──────────┘
┌──────────┐
│ enx.db-wal│ ← Write-Ahead Log (writers write here first)
└──────────┘
┌──────────┐
│ enx.db-shm│ ← Shared memory (coordination)
└──────────┘
```

### How WAL Works

#### 1. **Write Flow**

```
Step 1: Write to WAL file
─────────────────────────────────────────────────
Client: INSERT INTO words VALUES ('hello', '你好')
SQLite: Appends change to enx.db-wal
        (Main database enx.db NOT modified yet)

Step 2: Transaction commit
─────────────────────────────────────────────────
Client: COMMIT
SQLite: Marks transaction complete in WAL
        WAL file now contains: [INSERT hello 你好] [COMMIT]

Step 3: Checkpoint (periodic)
─────────────────────────────────────────────────
SQLite: Copies changes from WAL to main database
        enx.db-wal → enx.db
        Truncates or resets WAL file
```

#### 2. **Read Flow**

```
Traditional Mode:
─────────────────────────────────────────────────
Reader: SELECT * FROM words
        Must wait if writer is active ❌

WAL Mode:
─────────────────────────────────────────────────
Reader: SELECT * FROM words
        Reads from enx.db + uncommitted changes in WAL
        Can read even while writer is writing ✅
```

#### 3. **Read with Uncommitted WAL (Your Question!)**

**✅ Readers can see data in WAL even before checkpoint**

```
Timeline: UPDATE in WAL, Query before Checkpoint
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

10:00:00 - Initial State
─────────────────────────────────────────────────────────────
enx.db:
  id | english | chinese
  ---|---------|--------
  1  | hello   | 你好

enx.db-wal: (empty)

10:00:01 - Writer: UPDATE chinese
─────────────────────────────────────────────────────────────
UPDATE words SET chinese = '您好' WHERE english = 'hello';
COMMIT;

enx.db: (unchanged)
  id | english | chinese
  ---|---------|--------
  1  | hello   | 你好     ← Still old value

enx.db-wal: (has new data)
  Frame 1: [UPDATE words id=1 chinese='您好']
  Frame 2: [COMMIT]

10:00:02 - Reader: Query BEFORE Checkpoint
─────────────────────────────────────────────────────────────
SELECT * FROM words WHERE english = 'hello';

SQLite reads:
  Step 1: Check enx.db-shm (shared memory index)
          → Finds: "WAL has data for page containing id=1"

  Step 2: Read from WAL (priority over main DB)
          → Gets: chinese = '您好' (from WAL)

  Step 3: Returns merged result
          → Result: (1, 'hello', '您好') ✅ NEW DATA!

Reader sees updated data ✅ even though:
  - Data still only in WAL
  - enx.db not updated yet
  - Checkpoint hasn't happened yet

10:05:00 - Later: Checkpoint happens
─────────────────────────────────────────────────────────────
PRAGMA wal_checkpoint(PASSIVE);

enx.db: (now updated)
  id | english | chinese
  ---|---------|--------
  1  | hello   | 您好     ← Updated from WAL

enx.db-wal: (reset/truncated)
```

**How SQLite merges reads from enx.db + WAL**:

```
Reader query process in WAL mode:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Query starts: SELECT * FROM words WHERE id = 1

2. SQLite checks WAL index (in enx.db-shm):
   ┌─────────────────────────────────┐
   │ WAL Index (Shared Memory)       │
   ├─────────────────────────────────┤
   │ Page 1: Frame 5 (in WAL)        │ ← Page 1 has newer version in WAL
   │ Page 2: Not in WAL              │
   │ Page 3: Frame 7 (in WAL)        │
   └─────────────────────────────────┘

3. For page containing id=1:
   if (page in WAL) {
       Read from WAL  ✅ (newer version)
   } else {
       Read from enx.db (no WAL changes)
   }

4. Result: Merged view
   - Some pages from enx.db (no changes)
   - Some pages from WAL (has changes)
   - Reader sees consistent snapshot
```

**Detailed example with multiple records**:

```
Scenario: Partial data in WAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

enx.db (main database):
  id | english | chinese | update_time
  ---|---------|---------|------------
  1  | hello   | 你好    | 10:00
  2  | world   | 世界    | 10:00
  3  | bye     | 再见    | 10:00

enx.db-wal (has updates for id=1 and id=3):
  Frame 1: UPDATE words SET chinese='您好' WHERE id=1
  Frame 2: UPDATE words SET chinese='拜拜' WHERE id=3
  (id=2 not updated, not in WAL)

Query: SELECT * FROM words ORDER BY id;

SQLite reads:
  Row 1 (id=1): Check WAL → Found Frame 1 → Return '您好' (from WAL) ✅
  Row 2 (id=2): Check WAL → Not found → Return '世界' (from enx.db) ✅
  Row 3 (id=3): Check WAL → Found Frame 2 → Return '拜拜' (from WAL) ✅

Result:
  id | english | chinese | Source
  ---|---------|---------|--------
  1  | hello   | 您好    | WAL ✅
  2  | world   | 世界    | enx.db
  3  | bye     | 拜拜    | WAL ✅

Reader sees a consistent, merged view!
```

**Consistency guarantees**:

```
Transaction consistency in WAL mode:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scenario: Writer in middle of transaction
─────────────────────────────────────────────────────────────
10:00:00 - BEGIN TRANSACTION
10:00:01 - UPDATE words SET chinese='您好' WHERE id=1  ← In WAL, uncommitted
10:00:02 - Reader: SELECT ... WHERE id=1
           → Sees OLD data ('你好') ✅ Correct!
           → Uncommitted changes not visible

10:00:03 - UPDATE words SET chinese='您好' WHERE id=2  ← In WAL, uncommitted
10:00:04 - COMMIT ✅
10:00:05 - Reader: SELECT ... WHERE id=1
           → Sees NEW data ('您好') ✅ Correct!
           → Committed changes now visible

Key point: Readers see consistent snapshots
  - Before COMMIT: Old data
  - After COMMIT: New data (from WAL)
  - No partial/inconsistent reads
```

**Performance implications**:

```
Why reading from WAL is fast:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. WAL Index in Shared Memory (enx.db-shm):
   - Hash table: page_number → frame_number
   - O(1) lookup: "Is this page in WAL?"
   - Very fast (in RAM, not disk)

2. Sequential reads:
   If page in WAL: Read WAL frame (sequential)
   Else:           Read enx.db page (random, but cached)

3. Most pages NOT in WAL:
   - Only recently changed pages in WAL
   - Most data still from enx.db (fast)
   - WAL overhead minimal (~5-10% slower)

Example:
  Database: 1000 pages
  Recent changes: 10 pages in WAL

  Query touching 50 pages:
    40 pages from enx.db (fast, no WAL overhead)
    10 pages from WAL (check index + read WAL)

  Total overhead: 10/50 = 20% of reads check WAL
  Performance impact: ~2% slower (negligible)
```

### File Structure

#### **enx.db** (Main Database)
- Contains "checkpoint" state of data
- Updated periodically by checkpoint process
- Readers primarily read from here

#### **enx.db-wal** (Write-Ahead Log)
- Append-only file containing recent transactions
- Format: [page_number | page_data | frame_header] repeated
- Grows until checkpoint occurs

#### **enx.db-shm** (Shared Memory)
- Coordination between readers and writers
- Contains WAL index for fast lookups
- Automatically managed by SQLite

```
$ ls -lh enx.db*
-rw-r--r--  1 user  staff  500K Nov 12 10:00 enx.db
-rw-r--r--  1 user  staff   64K Nov 12 10:05 enx.db-wal    ← Recent changes
-rw-r--r--  1 user  staff   32K Nov 12 10:05 enx.db-shm    ← Coordination
```

### Key Advantages

#### 1. **Concurrent Readers and Writers**

```
Traditional Mode:
─────────────────────────────────────────────────
Time    Reader          Writer          Result
────────────────────────────────────────────────
10:00   SELECT ...      -               ✅ Read
10:01   SELECT ...      INSERT ...      ❌ Blocked
10:02   -               INSERT ...      ✅ Write
10:03   SELECT ...      INSERT ...      ❌ Blocked

Problem: Readers block writers, writers block readers
```

```
WAL Mode:
─────────────────────────────────────────────────
Time    Reader          Writer          Result
────────────────────────────────────────────────
10:00   SELECT ...      -               ✅ Read
10:01   SELECT ...      INSERT ...      ✅ Both work
10:02   SELECT ...      INSERT ...      ✅ Both work
10:03   SELECT ...      INSERT ...      ✅ Both work

Benefit: Readers and writers don't block each other
```

#### 2. **Better Write Performance**

```
Traditional Mode:
─────────────────────────────────────────────────
INSERT: Write to rollback journal → Write to database
        2 writes, synchronous, slower

WAL Mode:
─────────────────────────────────────────────────
INSERT: Append to WAL file
        1 write, sequential append, much faster
```

**Benchmark**:
```
Operation: Insert 1000 rows

Traditional Mode: 5.2 seconds
WAL Mode:         1.1 seconds  (5x faster!)
```

#### 3. **Crash Recovery**

```
Traditional Mode:
─────────────────────────────────────────────────
Crash during write → Rollback journal replays changes
                   → Database restored to previous state

WAL Mode:
─────────────────────────────────────────────────
Crash during write → WAL file contains complete transactions
                   → Committed transactions in WAL applied
                   → Uncommitted transactions ignored
                   → Database in consistent state
```

### Checkpoint Process

**Checkpoint** moves changes from WAL to main database:

```
Before Checkpoint:
┌──────────┐       ┌──────────┐
│ enx.db   │       │ enx.db-wal│
│ 1000 rows│       │ +50 rows  │ ← Recent inserts
└──────────┘       └──────────┘

After Checkpoint:
┌──────────┐       ┌──────────┐
│ enx.db   │       │ enx.db-wal│
│ 1050 rows│ ✅    │ (empty)   │ ← Truncated
└──────────┘       └──────────┘
```

#### Checkpoint Modes

```sql
-- PASSIVE: Don't block, checkpoint what's possible
PRAGMA wal_checkpoint(PASSIVE);

-- FULL: Wait for readers, checkpoint everything
PRAGMA wal_checkpoint(FULL);

-- RESTART: FULL + start new WAL file
PRAGMA wal_checkpoint(RESTART);

-- TRUNCATE: RESTART + truncate WAL to 0 bytes
PRAGMA wal_checkpoint(TRUNCATE);
```

### Manual Checkpoint APIs

**✅ Yes! SQLite provides multiple APIs to manually trigger WAL checkpoint**

#### 1. SQL API (PRAGMA)

**最简单的方式：使用 PRAGMA 语句**

```sql
-- PASSIVE checkpoint (推荐用于后台任务)
PRAGMA wal_checkpoint(PASSIVE);
-- 返回：(busy, log, checkpointed)
-- 例如：0|100|100
-- 意思：0=成功, 100页在日志中, 100页已checkpoint

-- FULL checkpoint (等待读者完成)
PRAGMA wal_checkpoint(FULL);

-- RESTART checkpoint (FULL + 重置WAL)
PRAGMA wal_checkpoint(RESTART);

-- TRUNCATE checkpoint (RESTART + 截断WAL到0字节)
PRAGMA wal_checkpoint(TRUNCATE);

-- 不指定模式（默认 PASSIVE）
PRAGMA wal_checkpoint;
```

**返回值解释**：

```
PRAGMA wal_checkpoint(mode) 返回：(busy, log_pages, checkpointed_pages)

busy:
  0 = 成功 checkpoint 所有页
  1 = 部分页因为有活跃读者而无法 checkpoint

log_pages:
  WAL 文件中的总页数

checkpointed_pages:
  成功 checkpoint 的页数

示例：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRAGMA wal_checkpoint(PASSIVE);
→ 0|500|500  ✅ 成功 checkpoint 500页
→ 1|500|300  ⚠️ 只 checkpoint 了300页（200页有读者在用）
→ 0|0|0      ✅ WAL 为空，无需 checkpoint
```

#### 2. Go API (database/sql)

**在 Go 中触发 checkpoint**

```go
package main

import (
    "database/sql"
    "fmt"
    "log"

    _ "github.com/mattn/go-sqlite3"
)

// Simple checkpoint (PASSIVE mode)
func checkpointSimple(db *sql.DB) error {
    _, err := db.Exec("PRAGMA wal_checkpoint(PASSIVE)")
    return err
}

// Checkpoint with result
func checkpointWithResult(db *sql.DB, mode string) (busy, logPages, checkpointed int, err error) {
    query := fmt.Sprintf("PRAGMA wal_checkpoint(%s)", mode)
    err = db.QueryRow(query).Scan(&busy, &logPages, &checkpointed)
    return
}

// Example usage
func main() {
    db, _ := sql.Open("sqlite3", "enx.db")
    defer db.Close()

    // Enable WAL
    db.Exec("PRAGMA journal_mode=WAL")

    // ... perform writes ...
    db.Exec("INSERT INTO words VALUES (...)")
    db.Exec("UPDATE user_dicts SET ...")

    // Manual checkpoint
    busy, log, ckpt, err := checkpointWithResult(db, "PASSIVE")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Checkpoint result:\n")
    fmt.Printf("  Busy: %d\n", busy)
    fmt.Printf("  WAL pages: %d\n", log)
    fmt.Printf("  Checkpointed: %d\n", ckpt)

    if busy == 1 {
        fmt.Println("⚠️ Some pages couldn't be checkpointed (active readers)")
    } else {
        fmt.Println("✅ All pages checkpointed successfully")
    }
}

// Checkpoint with retry
func checkpointWithRetry(db *sql.DB, maxRetries int) error {
    for i := 0; i < maxRetries; i++ {
        busy, _, _, err := checkpointWithResult(db, "PASSIVE")
        if err != nil {
            return err
        }

        if busy == 0 {
            log.Printf("✅ Checkpoint successful on attempt %d", i+1)
            return nil
        }

        log.Printf("⚠️ Checkpoint busy, retrying (%d/%d)", i+1, maxRetries)
        time.Sleep(100 * time.Millisecond)
    }

    return fmt.Errorf("checkpoint failed after %d retries", maxRetries)
}

// Background checkpoint worker
func startCheckpointWorker(db *sql.DB, interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for range ticker.C {
        busy, log, ckpt, err := checkpointWithResult(db, "PASSIVE")
        if err != nil {
            log.Printf("❌ Checkpoint error: %v", err)
            continue
        }

        walSizeMB := float64(log * 4096) / 1024 / 1024
        log.Printf("📊 Checkpoint: WAL %.2fMB (%d pages), checkpointed %d pages, busy: %d",
            walSizeMB, log, ckpt, busy)

        // Force RESTART if WAL too large and not busy
        if walSizeMB > 50 && busy == 0 {
            log.Println("⚠️ WAL > 50MB, forcing RESTART checkpoint")
            db.Exec("PRAGMA wal_checkpoint(RESTART)")
        }
    }
}

// Checkpoint on shutdown
func gracefulShutdown(db *sql.DB) {
    log.Println("🛑 Shutting down, performing final checkpoint...")

    // Use TRUNCATE to clean up WAL file
    busy, log, ckpt, err := checkpointWithResult(db, "TRUNCATE")
    if err != nil {
        log.Printf("❌ Final checkpoint error: %v", err)
    } else {
        log.Printf("✅ Final checkpoint: %d/%d pages, WAL truncated", ckpt, log)
    }

    db.Close()
    log.Println("✅ Database closed cleanly")
}
```

#### 3. C API (for advanced use)

**SQLite C API**

```c
#include <sqlite3.h>

// Basic checkpoint
int checkpoint_basic(sqlite3 *db) {
    return sqlite3_wal_checkpoint(db, NULL);  // NULL = all databases
}

// Checkpoint with mode (v2 API, recommended)
int checkpoint_with_mode(sqlite3 *db, int mode) {
    int nLog, nCkpt;  // Output parameters

    int rc = sqlite3_wal_checkpoint_v2(
        db,              // Database connection
        NULL,            // Database name (NULL = all attached DBs)
        mode,            // SQLITE_CHECKPOINT_PASSIVE/FULL/RESTART/TRUNCATE
        &nLog,           // OUT: Pages in WAL
        &nCkpt           // OUT: Pages checkpointed
    );

    printf("Checkpoint: WAL=%d pages, checkpointed=%d pages\n", nLog, nCkpt);

    return rc;
}

// Checkpoint modes
#define SQLITE_CHECKPOINT_PASSIVE  0
#define SQLITE_CHECKPOINT_FULL     1
#define SQLITE_CHECKPOINT_RESTART  2
#define SQLITE_CHECKPOINT_TRUNCATE 3

// Example usage
void example() {
    sqlite3 *db;
    sqlite3_open("enx.db", &db);

    // Enable WAL
    sqlite3_exec(db, "PRAGMA journal_mode=WAL", NULL, NULL, NULL);

    // ... perform operations ...

    // Checkpoint
    int nLog, nCkpt;
    int rc = sqlite3_wal_checkpoint_v2(
        db, NULL, SQLITE_CHECKPOINT_PASSIVE, &nLog, &nCkpt
    );

    if (rc == SQLITE_OK) {
        printf("✅ Checkpoint successful: %d/%d pages\n", nCkpt, nLog);
    } else {
        printf("❌ Checkpoint failed: %s\n", sqlite3_errmsg(db));
    }

    sqlite3_close(db);
}
```

#### 4. Checkpoint Hooks (C API)

**注册 checkpoint 回调**

```c
// Checkpoint hook function
int checkpoint_hook(void *pArg, sqlite3 *db, const char *zDb, int nFrame) {
    printf("Checkpoint hook: %d frames to checkpoint\n", nFrame);
    return SQLITE_OK;  // Allow checkpoint
}

// Register hook
void setup_checkpoint_hook(sqlite3 *db) {
    sqlite3_wal_hook(db, checkpoint_hook, NULL);
}

// This hook is called BEFORE auto-checkpoint
// Can be used to:
// - Log checkpoint events
// - Delay checkpoint if needed
// - Perform cleanup before checkpoint
```

#### 5. When to Trigger Manual Checkpoint

**使用场景**

```
Scenario 1: Application shutdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
func main() {
    db, _ := sql.Open("sqlite3", "enx.db")
    defer func() {
        // Clean shutdown with TRUNCATE
        db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
        db.Close()
    }()

    // ... application logic ...
}

Why: Ensures WAL is merged and cleaned up before exit


Scenario 2: Before backup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
func backupDatabase(db *sql.DB) error {
    // Checkpoint to merge WAL into main DB
    _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
    if err != nil {
        return err
    }

    // Now safe to copy enx.db (contains all data)
    return copyFile("enx.db", "backup/enx.db")
}

Why: Ensures backup includes all data (not just main DB)


Scenario 3: Low disk space
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
func monitorDiskSpace(db *sql.DB) {
    ticker := time.NewTicker(1 * time.Minute)
    for range ticker.C {
        diskFree := getDiskFreeSpace()
        if diskFree < 100*1024*1024 {  // < 100MB
            log.Warn("Low disk space, checkpointing WAL")
            db.Exec("PRAGMA wal_checkpoint(RESTART)")
        }
    }
}

Why: Merge WAL to free up disk space


Scenario 4: Performance maintenance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
func performanceMaintenance(db *sql.DB) {
    var logPages int
    db.QueryRow("PRAGMA wal_checkpoint(PASSIVE)").Scan(&_, &logPages, &_)

    walSizeMB := float64(logPages * 4096) / 1024 / 1024
    if walSizeMB > 50 {
        log.Warn("WAL > 50MB, forcing checkpoint")
        db.Exec("PRAGMA wal_checkpoint(RESTART)")
    }
}

Why: Keep WAL size manageable for good read performance


Scenario 5: Scheduled maintenance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
func scheduledMaintenance(db *sql.DB) {
    // Run every night at 2 AM
    schedule := cron.New()
    schedule.AddFunc("0 2 * * *", func() {
        log.Info("Running scheduled checkpoint")
        db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
        db.Exec("PRAGMA optimize")  // Also optimize DB
        log.Info("Maintenance complete")
    })
    schedule.Start()
}

Why: Periodic cleanup during low-activity hours
```

#### 6. Best Practices

**手动 checkpoint 最佳实践**

```
✅ DO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Use PASSIVE for background tasks
   - Non-blocking, safe during normal operations
   - Good for periodic maintenance

2. Use TRUNCATE on shutdown
   - Cleans up WAL file completely
   - Leaves database in clean state

3. Use RESTART when WAL > 50MB
   - Keeps WAL size manageable
   - Improves read performance

4. Checkpoint before backup
   - Ensures backup is complete
   - Simpler backup process (one file)

5. Handle busy return value
   - Retry if busy=1 (readers active)
   - Don't force FULL/RESTART if busy


❌ DON'T:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Don't use FULL in hot path
   - Blocks on active readers
   - Can cause latency spikes

2. Don't checkpoint too frequently
   - Wastes CPU, defeats WAL purpose
   - Let auto-checkpoint handle it

3. Don't ignore errors
   - Check return value
   - Log failures for debugging

4. Don't checkpoint in transactions
   - Can interfere with transaction
   - Checkpoint outside transaction

5. Don't assume TRUNCATE always truncates
   - May not truncate if readers active
   - Check return value
```

#### 7. Complete Example for Your Project

**ENX 项目完整示例**

```go
package main

import (
    "database/sql"
    "log"
    "os"
    "os/signal"
    "syscall"
    "time"

    _ "github.com/mattn/go-sqlite3"
)

type Database struct {
    db *sql.DB
}

func NewDatabase(path string) (*Database, error) {
    db, err := sql.Open("sqlite3", path)
    if err != nil {
        return nil, err
    }

    // Enable WAL
    if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
        return nil, err
    }

    // Configure auto-checkpoint
    if _, err := db.Exec("PRAGMA wal_autocheckpoint=1000"); err != nil {
        return nil, err
    }

    d := &Database{db: db}

    // Start background checkpoint worker
    go d.checkpointWorker()

    // Setup graceful shutdown
    d.setupGracefulShutdown()

    return d, nil
}

// Background checkpoint worker
func (d *Database) checkpointWorker() {
    ticker := time.NewTicker(5 * time.Minute)
    defer ticker.Stop()

    for range ticker.C {
        d.periodicCheckpoint()
    }
}

// Periodic checkpoint
func (d *Database) periodicCheckpoint() {
    var busy, logPages, checkpointed int
    err := d.db.QueryRow("PRAGMA wal_checkpoint(PASSIVE)").Scan(
        &busy, &logPages, &checkpointed,
    )
    if err != nil {
        log.Printf("❌ Checkpoint error: %v", err)
        return
    }

    walSizeMB := float64(logPages * 4096) / 1024 / 1024
    log.Printf("📊 WAL: %.2fMB (%d pages), checkpointed: %d, busy: %d",
        walSizeMB, logPages, checkpointed, busy)

    // Force RESTART if WAL > 50MB and not busy
    if walSizeMB > 50 && busy == 0 {
        log.Println("⚠️ WAL > 50MB, forcing RESTART checkpoint")
        d.db.Exec("PRAGMA wal_checkpoint(RESTART)")
    }
}

// Manual checkpoint (for backup, etc.)
func (d *Database) Checkpoint() error {
    log.Println("🔄 Manual checkpoint requested")

    var busy, logPages, checkpointed int
    err := d.db.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(
        &busy, &logPages, &checkpointed,
    )
    if err != nil {
        return err
    }

    if busy == 1 {
        log.Printf("⚠️ Partial checkpoint: %d/%d pages (readers active)",
            checkpointed, logPages)
    } else {
        log.Printf("✅ Checkpoint complete: %d pages, WAL truncated", logPages)
    }

    return nil
}

// Graceful shutdown
func (d *Database) setupGracefulShutdown() {
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

    go func() {
        <-sigChan
        log.Println("🛑 Shutdown signal received")
        d.Close()
        os.Exit(0)
    }()
}

// Close with final checkpoint
func (d *Database) Close() error {
    log.Println("🔄 Performing final checkpoint...")

    // TRUNCATE checkpoint on shutdown
    var busy, logPages, checkpointed int
    err := d.db.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(
        &busy, &logPages, &checkpointed,
    )
    if err != nil {
        log.Printf("⚠️ Final checkpoint error: %v", err)
    } else {
        log.Printf("✅ Final checkpoint: %d/%d pages", checkpointed, logPages)
    }

    // Close database
    if err := d.db.Close(); err != nil {
        return err
    }

    log.Println("✅ Database closed cleanly")
    return nil
}

func main() {
    db, err := NewDatabase("enx.db")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Your application logic...

    // Manual checkpoint when needed
    db.Checkpoint()
}
```

### Summary: Checkpoint APIs

| API Type | Command | Use Case |
|----------|---------|----------|
| **SQL** | `PRAGMA wal_checkpoint(mode)` | 最简单，所有语言通用 |
| **Go** | `db.Exec("PRAGMA wal_checkpoint(...)")` | Go 应用推荐 |
| **C** | `sqlite3_wal_checkpoint_v2()` | 高级用户，C 扩展 |
| **Hook** | `sqlite3_wal_hook()` | 监控 checkpoint 事件 |

#### Auto-Checkpoint

```sql
-- Checkpoint automatically when WAL reaches 1000 pages (~4MB)
PRAGMA wal_autocheckpoint=1000;

-- Disable auto-checkpoint (manual control)
PRAGMA wal_autocheckpoint=0;
```

### SQLite Automatic Checkpoint Mechanisms

**✅ Yes! SQLite has multiple automatic checkpoint mechanisms**

#### 1. Auto-Checkpoint (Most Common)

**基于写入页数的自动触发**

```
Trigger Condition:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WAL 文件达到配置的页数阈值时，下一次写操作会触发 checkpoint

Default: 1000 pages (4MB)
Mode: PASSIVE (non-blocking)

Timing:
┌─────────────────────────────────────────────────────────┐
│ Write 1 → Write 2 → ... → Write 999 → Write 1000        │
│                                         ↓                │
│                               Checkpoint triggered!      │
│                               (on next write commit)     │
└─────────────────────────────────────────────────────────┘

Important: Checkpoint happens AFTER the threshold is reached,
           on the NEXT write transaction commit
```

**Example**

```go
// Configure auto-checkpoint threshold
db.Exec("PRAGMA wal_autocheckpoint=1000")

// These writes accumulate in WAL
for i := 0; i < 1100; i++ {
    db.Exec("INSERT INTO words VALUES (...)")
}
// After ~1000 pages written, next transaction triggers checkpoint

// Check status
var pages int
db.QueryRow("PRAGMA wal_checkpoint(PASSIVE)").Scan(&_, &pages, &_)
fmt.Printf("WAL pages: %d\n", pages)  // Should be < 100 after checkpoint
```

#### 2. Last Connection Close

**最后一个连接关闭时触发**

```
Trigger Condition:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当最后一个数据库连接关闭时，SQLite 会尝试执行 checkpoint

Mode: PASSIVE (default) or TRUNCATE (configurable)

Scenario 1: Single connection
┌─────────────────────────────────────────────────────────┐
│ App starts → Opens DB → ... → Closes DB                 │
│                                    ↓                     │
│                          Checkpoint triggered!           │
│                          WAL merged to main DB           │
└─────────────────────────────────────────────────────────┘

Scenario 2: Multiple connections
┌─────────────────────────────────────────────────────────┐
│ Conn 1: Open → ... → Close                              │
│ Conn 2: Open → ... → Close                              │
│ Conn 3: Open → ... → Close (last one!)                  │
│                         ↓                                │
│               Checkpoint triggered!                      │
└─────────────────────────────────────────────────────────┘

Why: Clean up WAL file when database is no longer in use
```

**Example**

```go
func main() {
    // Open database
    db, _ := sql.Open("sqlite3", "enx.db")
    db.Exec("PRAGMA journal_mode=WAL")

    // Perform writes
    db.Exec("INSERT INTO words VALUES (...)")
    db.Exec("UPDATE user_dicts SET ...")

    // Close database (last connection)
    db.Close()  // ← Triggers checkpoint here!

    // After close:
    // - WAL merged to enx.db
    // - WAL file may be truncated (depending on config)
}

// Check on disk
$ ls -lh enx.db*
-rw-r--r-- 1 user user 500K enx.db        # All data here
-rw-r--r-- 1 user user  32K enx.db-wal    # Small residual (or truncated)
-rw-r--r-- 1 user user  32K enx.db-shm    # Shared memory
```

#### 3. Checkpoint on Commit (Conditional)

**提交事务时的条件触发**

```
Trigger Condition:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
写事务 COMMIT 时，如果满足以下条件之一：

1. WAL 达到 auto-checkpoint 阈值
2. 系统资源压力（内存/磁盘）
3. 长时间未 checkpoint（某些实现）

Timing:
┌─────────────────────────────────────────────────────────┐
│ BEGIN TRANSACTION                                        │
│   INSERT INTO words VALUES (...)                         │
│   UPDATE user_dicts SET ...                              │
│ COMMIT  ← Check if checkpoint needed                    │
│         ↓                                                │
│   If threshold reached → Trigger checkpoint              │
└─────────────────────────────────────────────────────────┘

Note: This is implementation-dependent behavior
      Primary mechanism is still auto-checkpoint threshold
```

#### 4. Forced Checkpoint (Programmatic)

**程序主动触发**

```
Trigger Condition:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
应用程序显式调用 checkpoint API

Methods:
- PRAGMA wal_checkpoint(mode)
- sqlite3_wal_checkpoint_v2()
- Background worker
- Scheduled maintenance

Timing: Anytime, controlled by application

Use Cases:
┌─────────────────────────────────────────────────────────┐
│ ✅ Before backup                                         │
│ ✅ Before shutdown                                       │
│ ✅ Low disk space                                        │
│ ✅ WAL too large (>50MB)                                 │
│ ✅ Scheduled maintenance (2 AM)                          │
└─────────────────────────────────────────────────────────┘
```

#### 5. System Events (Advanced)

**系统级触发条件**

```
Trigger Conditions:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Memory Pressure
   - System running low on memory
   - SQLite may checkpoint to free cache

2. Disk Sync Events
   - fsync() or similar system calls
   - Database pages being flushed to disk

3. Lock Contention
   - Many readers waiting
   - Checkpoint to improve read performance

4. Process Termination
   - SIGTERM, SIGINT signals
   - Graceful shutdown attempts checkpoint

Note: These are less common, implementation-specific
      Primary mechanism is still auto-checkpoint threshold
```

#### Complete Auto-Checkpoint Workflow

**完整的自动 checkpoint 流程**

```
Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

T0: App starts
    ├─ Open database
    ├─ Enable WAL: PRAGMA journal_mode=WAL
    └─ Set threshold: PRAGMA wal_autocheckpoint=1000

T1-T999: Normal writes (WAL grows)
    ├─ Write 1: INSERT INTO words ... → WAL: 1 page
    ├─ Write 2: UPDATE user_dicts ... → WAL: 2 pages
    ├─ ...
    └─ Write 999: INSERT INTO words ... → WAL: 999 pages

T1000: Threshold reached
    ├─ Write 1000: INSERT INTO words ... → WAL: 1000 pages
    └─ ⚠️ Threshold reached! Checkpoint scheduled

T1001: Next write commits
    ├─ BEGIN TRANSACTION
    ├─ INSERT INTO words ...
    ├─ COMMIT
    │   ├─ 🔄 Auto-checkpoint triggered (PASSIVE mode)
    │   ├─ Merge WAL → enx.db (non-blocking)
    │   └─ Reset WAL write position
    └─ ✅ Transaction committed, checkpoint complete

T1002+: Continue normally
    ├─ WAL restarted from beginning
    └─ Cycle repeats

T_end: App exits
    ├─ db.Close() called
    ├─ 🔄 Final checkpoint (last connection)
    └─ ✅ Clean shutdown


Monitoring:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check WAL status anytime:
PRAGMA wal_checkpoint(PASSIVE);
→ Returns: (busy, log_pages, checkpointed_pages)

Example outputs:
0|0|0       ✅ WAL empty, no checkpoint needed
0|500|500   ✅ Checkpoint successful, 500 pages merged
1|1000|800  ⚠️ Partial checkpoint, 200 pages still have readers
```

#### Configuration Examples

**针对不同场景的配置**

```go
// Scenario 1: Low-frequency writes (your case)
// Default is perfect - checkpoint every 4MB
db.Exec("PRAGMA wal_autocheckpoint=1000")  // 4MB

// Scenario 2: High-frequency writes
// Increase threshold to reduce checkpoint frequency
db.Exec("PRAGMA wal_autocheckpoint=5000")  // 20MB

// Scenario 3: Manual control (advanced)
// Disable auto-checkpoint, manual checkpoints only
db.Exec("PRAGMA wal_autocheckpoint=0")
// Then manually checkpoint in background worker
go func() {
    ticker := time.NewTicker(5 * time.Minute)
    for range ticker.C {
        db.Exec("PRAGMA wal_checkpoint(PASSIVE)")
    }
}()

// Scenario 4: Aggressive checkpointing
// Checkpoint very frequently (for small databases)
db.Exec("PRAGMA wal_autocheckpoint=100")  // 400KB
```

#### Summary: When Does Checkpoint Happen?

| Trigger Mechanism | Frequency | Mode | Automatic? |
|-------------------|-----------|------|------------|
| **Auto-checkpoint** | Every N pages (default: 1000) | PASSIVE | ✅ Yes |
| **Last connection close** | On app exit | PASSIVE/TRUNCATE | ✅ Yes |
| **Commit checkpoint** | On threshold + commit | PASSIVE | ✅ Yes |
| **Manual PRAGMA** | Anytime (app-controlled) | Configurable | ❌ No |
| **Background worker** | Scheduled (e.g., 5 min) | Configurable | ✅ Yes (if implemented) |
| **System events** | Rare (memory pressure, etc.) | PASSIVE | ✅ Yes |

**Key Takeaway:**

```
For your ENX project:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Auto-checkpoint (default 1000 pages = 4MB) handles most cases
✅ Last connection close cleans up on app exit
✅ No manual intervention needed for normal usage

Optional enhancements:
- Background worker for proactive checkpointing
- Shutdown checkpoint (TRUNCATE) for clean exit
- Monitoring/logging for WAL size tracking
```

### WAL Size Limits and Capacity

#### Default Configuration

**默认 Auto-Checkpoint 阈值：1000 页**

```
Page size:       4096 bytes (4KB, SQLite default)
Checkpoint at:   1000 pages
Maximum WAL:     1000 × 4KB = 4MB (before auto-checkpoint)

计算：
─────────────────────────────────────────────────────────────
Default: PRAGMA wal_autocheckpoint=1000
         PRAGMA page_size=4096

WAL capacity = 1000 pages × 4KB/page = 4MB

这意味着：WAL 最多累积 4MB 数据后自动触发 checkpoint
```

#### Theoretical Maximum (No Limit!)

**WAL 理论上没有硬性大小限制**

```
重要：WAL 文件本身没有最大大小限制！
─────────────────────────────────────────────────────────────

如果禁用 auto-checkpoint：
PRAGMA wal_autocheckpoint=0;

WAL 可以无限增长：
- 10MB, 100MB, 1GB, 10GB... 理论上可以无限大
- 只受限于磁盘空间
- 但会导致严重性能问题（见下文）
```

#### Practical Limits

**实际使用中的推荐限制**

```
推荐配置：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Small database (<10MB):
  PRAGMA wal_autocheckpoint=1000;    // 4MB WAL

Medium database (10MB-100MB):
  PRAGMA wal_autocheckpoint=2000;    // 8MB WAL

Large database (>100MB):
  PRAGMA wal_autocheckpoint=5000;    // 20MB WAL

Your case (enx.db ~500KB):
  PRAGMA wal_autocheckpoint=1000;    // 4MB WAL ✅ Perfect!

Reason: 4MB WAL = 8x your entire database
        More than enough for typical usage
```

#### How Much Data Can WAL Hold?

**WAL 容量 = 页数 × 页大小**

```
Examples with default 4KB pages:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

wal_autocheckpoint | Max WAL Size | Approximate Data
-------------------|--------------|------------------
100                | 400KB        | ~500 rows (200 bytes each)
1000 (default)     | 4MB          | ~5,000 rows
2000               | 8MB          | ~10,000 rows
5000               | 20MB         | ~25,000 rows
10000              | 40MB         | ~50,000 rows
0 (disabled)       | Unlimited    | Limited only by disk space

Note: "Approximate Data" assumes typical word records
      Actual capacity depends on record size and update patterns
```

#### Calculate Capacity for Your Use Case

**以你的 words 表为例**

```
Your table structure:
─────────────────────────────────────────────────────────────
CREATE TABLE words (
    id INTEGER PRIMARY KEY,        -- 8 bytes
    english TEXT NOT NULL,         -- ~10 bytes avg
    chinese TEXT,                  -- ~10 bytes avg
    pronunciation TEXT,            -- ~20 bytes avg
    update_datetime TEXT,          -- 20 bytes
    load_count INTEGER             -- 8 bytes
);
-- Total per row: ~76 bytes (data)
-- Plus SQLite overhead: ~100-150 bytes per row

Page size: 4KB = 4096 bytes
Rows per page: 4096 / 150 = ~27 rows per page

With default wal_autocheckpoint=1000:
  1000 pages × 27 rows/page = ~27,000 word records

Your current database: ~1000 words
WAL capacity: 27x your entire database ✅ More than enough!

Example scenario:
─────────────────────────────────────────────────────────────
You add 50 words:        50 rows = ~2 pages
You update 100 words:    100 rows = ~4 pages
You mark 200 learned:    200 rows = ~8 pages

Total: 14 pages in WAL (out of 1000 capacity)
Checkpoint will NOT trigger yet (only 1.4% full)

You would need to modify ~27,000 words to trigger checkpoint!
```

#### WAL Growth Patterns

**不同操作对 WAL 大小的影响**

```
Operation patterns and WAL growth:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. INSERT (新增)
   Each INSERT: 1 page per ~27 rows

   Example: INSERT 1000 new words
   WAL size: 1000 / 27 = ~37 pages (~150KB)

2. UPDATE (更新)
   Each UPDATE: 1 page per modified row

   Example: UPDATE 1000 existing words
   WAL size: ~37 pages (~150KB)

3. DELETE (删除)
   Each DELETE: 1 page per deleted row

   Example: DELETE 1000 words
   WAL size: ~37 pages (~150KB)

4. Transaction size impact:
   ─────────────────────────────────────────────────────────
   Small transactions (< 100 rows):
     WAL grows slowly, checkpoint rarely needed

   Large transactions (> 10,000 rows):
     WAL grows fast, checkpoint frequently

   Your typical usage (add 10-50 words/day):
     WAL: < 2 pages/day
     Checkpoint: Every few months at current pace
```

#### When WAL Gets Too Large

**WAL 过大的影响和处理**

```
Performance degradation with large WAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WAL Size        | Read Performance | Checkpoint Time | Status
----------------|------------------|-----------------|--------
< 10MB          | Excellent        | < 1 second      | ✅ Optimal
10-50MB         | Good             | 1-5 seconds     | ✅ OK
50-100MB        | Acceptable       | 5-10 seconds    | ⚠️ Consider checkpoint
100-500MB       | Slow             | 10-60 seconds   | ⚠️ Should checkpoint
> 500MB         | Very slow        | > 60 seconds    | ❌ Must checkpoint

Why performance degrades:
1. Larger WAL index to search
2. More frames to check per read
3. Checkpoint takes longer (blocks some operations)

Solution: Adjust wal_autocheckpoint to trigger earlier
```

#### Monitoring WAL Size

**如何检查和监控 WAL 大小**

```sql
-- Check WAL file size in pages
PRAGMA wal_checkpoint(PASSIVE);
-- Returns: (busy, log_pages, checkpointed_pages)

-- Example output:
-- 0|237|237
-- Meaning: 237 pages in WAL, all checkpointed
-- WAL size: 237 × 4KB = 948KB

-- Get detailed WAL stats
SELECT
    page_count,
    page_size,
    page_count * page_size / 1024 / 1024 as wal_size_mb
FROM pragma_page_count('wal');
```

```go
// Monitor WAL size in Go
func monitorWALSize(db *sql.DB) {
    var busy, logPages, checkpointedPages int
    err := db.QueryRow("PRAGMA wal_checkpoint(PASSIVE)").Scan(
        &busy, &logPages, &checkpointedPages,
    )

    walSizeMB := float64(logPages * 4096) / 1024 / 1024

    log.Printf("WAL: %.2f MB (%d pages)", walSizeMB, logPages)

    if walSizeMB > 10 {
        log.Warn("WAL size exceeds 10MB, consider checkpoint")
        db.Exec("PRAGMA wal_checkpoint(RESTART)")
    }
}
```

```bash
# Check WAL size on disk
$ ls -lh enx.db-wal
-rw-r--r-- 1 user staff 2.3M Nov 12 10:00 enx.db-wal

# Calculate pages (assuming 4KB page size)
$ echo "scale=2; $(stat -f%z enx.db-wal) / 4096" | bc
573.00  # 573 pages in WAL
```

#### Configuring WAL Limits

**调整 WAL 阈值**

```sql
-- Small WAL (checkpoint frequently)
PRAGMA wal_autocheckpoint=500;    -- 2MB

-- Default (balanced)
PRAGMA wal_autocheckpoint=1000;   -- 4MB

-- Large WAL (checkpoint less frequently, better write performance)
PRAGMA wal_autocheckpoint=5000;   -- 20MB

-- Disable auto-checkpoint (manual control)
PRAGMA wal_autocheckpoint=0;      -- Unlimited

-- Important: This setting persists in the database!
-- Set once, applies to all future connections
```

#### Best Practices for Your Project

**针对 ENX 项目的建议**

```
Your situation:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Database size:      ~500KB (1000 words)
Daily changes:      10-50 words
Change frequency:   Low (human usage)
WAL capacity:       4MB (27,000 words)

Recommendation:
  PRAGMA wal_autocheckpoint=1000;  ✅ Default is perfect!

Reasons:
1. 4MB WAL = 50x your typical daily changes
2. Auto-checkpoint rarely triggers (low frequency)
3. When it does, < 1 second (not noticeable)
4. No manual management needed

Alternative scenarios:

If you do bulk imports (1000+ words at once):
  PRAGMA wal_autocheckpoint=2000;  // 8MB, more headroom

If you want checkpoint more often:
  PRAGMA wal_autocheckpoint=500;   // 2MB, checkpoint sooner

If using on low-storage device:
  PRAGMA wal_autocheckpoint=250;   // 1MB, save disk space
```

### Summary: WAL Size Limits

| Metric | Value |
|--------|-------|
| **Theoretical max** | Unlimited (disk space) |
| **Default threshold** | 1000 pages (4MB) |
| **Recommended max** | 10-50MB (performance) |
| **Your project needs** | 4MB (default) is perfect |
| **Typical WAL size** | < 1MB (with 1000 words) |
| **Capacity** | ~27,000 words before checkpoint |

### WAL File Lifecycle (enx.db-wal)

#### When Data is Written to WAL

**每次写入操作都会写入 WAL**：

```
Timeline of WAL writes:
─────────────────────────────────────────────────────────────
10:00:00 - db.Exec("INSERT INTO words VALUES ('hello', '你好')")
           → enx.db-wal: Append [Frame 1: INSERT hello]
           → enx.db: NOT modified yet

10:00:01 - db.Exec("UPDATE user_dicts SET learned = 1 WHERE word_id = 5")
           → enx.db-wal: Append [Frame 2: UPDATE user_dicts]
           → enx.db: Still NOT modified

10:00:02 - tx.Commit()
           → enx.db-wal: Append [Commit marker]
           → enx.db: STILL NOT modified (changes only in WAL)
           → Transaction is DURABLE (even though not in main DB)

10:00:03 - db.Exec("INSERT INTO words VALUES ('world', '世界')")
           → enx.db-wal: Append [Frame 3: INSERT world]

Current state:
enx.db-wal: [Frame 1, Frame 2, Commit, Frame 3] (growing)
enx.db:     Old state (no new changes yet)
```

#### When WAL is Checkpointed (Merged to Main DB)

**✅ Correct understanding: WAL is periodically reclaimed by SQLite**

```
Checkpoint triggers (WAL → enx.db):
─────────────────────────────────────────────────────────────

1. Auto-checkpoint (most common)
   Trigger: WAL reaches 1000 pages (~4MB by default)

   10:05:00 - WAL size: 900 pages
   10:05:30 - WAL size: 1000 pages (threshold reached)
              → SQLite: AUTO CHECKPOINT
              → Copy frames from enx.db-wal to enx.db
              → enx.db-wal: Reset to beginning (reused)
              → File still exists, but content overwritten

2. Manual checkpoint
   db.Exec("PRAGMA wal_checkpoint(PASSIVE)")

3. Database close
   db.Close()
   → Final checkpoint before closing

4. Read after long time
   If no recent checkpoint and readers need consistent view
```

#### WAL Content Management

**重要：WAL 文件不是"删除"，而是"重用"**

```
WAL file behavior:
─────────────────────────────────────────────────────────────

Phase 1: WAL file created (first write after enabling WAL)
  $ ls -lh enx.db*
  enx.db          500K
  enx.db-wal        0K  ← Created but empty
  enx.db-shm       32K

Phase 2: Writes accumulate in WAL
  10:00 - INSERT hello     → enx.db-wal: 4K
  10:01 - INSERT world     → enx.db-wal: 8K
  10:02 - INSERT goodbye   → enx.db-wal: 12K
  ...
  10:30 - Many inserts     → enx.db-wal: 4MB (1000 pages)

Phase 3: Auto-checkpoint triggers
  10:30:01 - Checkpoint starts
             1. Copy 4MB from enx.db-wal to enx.db
             2. Mark frames as "checkpointed" in WAL
             3. Reset WAL write position to beginning

  $ ls -lh enx.db*
  enx.db          504K  ← Grew by 4MB of data
  enx.db-wal      4MB   ← File still exists (not deleted)

Phase 4: WAL reused (not deleted)
  10:31 - INSERT new       → enx.db-wal: Overwrites from beginning
  10:32 - INSERT another   → enx.db-wal: Continues overwriting

  File size may stay same, but content is reused
```

#### Detailed Checkpoint Behavior

```
PASSIVE Checkpoint (default auto-checkpoint):
─────────────────────────────────────────────────────────────
Before:
  enx.db-wal: [1000 frames, 4MB]
  Active readers: 2 connections reading frames 1-500

Checkpoint process:
  1. Check for active readers on each frame
  2. Frame 1-500:   Skip (readers still using) ✋
  3. Frame 501-1000: Copy to enx.db ✅
  4. Reset write position to frame 501

After:
  enx.db-wal: [Frames 1-500 still present, new writes at 501]
  File not truncated, partially checkpointed

Next writes:
  New frames written starting at position 501
  WAL grows: 501, 502, 503...

─────────────────────────────────────────────────────────────
FULL Checkpoint:
─────────────────────────────────────────────────────────────
Before:
  enx.db-wal: [1000 frames, 4MB]
  Active readers: 2 connections

Checkpoint process:
  1. WAIT for all readers to finish ⏳
  2. Once no readers, copy ALL frames to enx.db ✅
  3. Reset write position to 0

After:
  enx.db-wal: [File size 4MB, but all frames checkpointed]
  Write position at 0, ready for reuse

─────────────────────────────────────────────────────────────
TRUNCATE Checkpoint:
─────────────────────────────────────────────────────────────
Before:
  enx.db-wal: [1000 frames, 4MB]

Checkpoint process:
  1. WAIT for all readers to finish
  2. Copy ALL frames to enx.db
  3. ftruncate(wal_fd, 0) → Physically shrink file to 0 bytes ✂️

After:
  enx.db-wal: [File size 0 bytes] ← Actually deleted content

This is the ONLY mode that "deletes" WAL content
```

#### When WAL File is Actually Deleted

```
WAL file deletion scenarios:
─────────────────────────────────────────────────────────────

❌ NOT deleted on checkpoint:
   PASSIVE/FULL/RESTART: File remains, content reused

✅ Deleted when:
   1. Switch journal mode:
      PRAGMA journal_mode=DELETE;  → enx.db-wal deleted

   2. Last connection closes + no writes:
      All connections: db.Close()
      If WAL is empty → enx.db-wal may be removed

   3. Manual deletion (dangerous!):
      rm enx.db-wal  ← DON'T do this while DB is open!
```

#### Practical Example

```go
// Real-world WAL lifecycle
func demonstrateWALLifecycle() {
    db, _ := sql.Open("sqlite3", "enx.db")
    db.Exec("PRAGMA journal_mode=WAL")
    db.Exec("PRAGMA wal_autocheckpoint=1000")

    // Phase 1: Initial writes
    for i := 0; i < 500; i++ {
        db.Exec("INSERT INTO words ...")
        // WAL size: ~2MB
    }
    fmt.Println("WAL size: ~2MB, NOT checkpointed yet")

    // Phase 2: Trigger auto-checkpoint
    for i := 0; i < 600; i++ {
        db.Exec("INSERT INTO words ...")
        // After insert 500: WAL reaches 1000 pages → AUTO CHECKPOINT
    }
    fmt.Println("WAL auto-checkpointed, content merged to enx.db")
    fmt.Println("WAL file still exists, but write position reset")

    // Phase 3: More writes (reuses WAL)
    for i := 0; i < 100; i++ {
        db.Exec("INSERT INTO words ...")
        // Writes to WAL starting from position 0 (reused)
    }
    fmt.Println("WAL reused, size: ~400KB")

    // Phase 4: Manual checkpoint with truncate
    db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
    fmt.Println("WAL truncated to 0 bytes")

    // Phase 5: Close database
    db.Close()
    // WAL file may be deleted if empty, or kept for next open
}
```

#### Summary: WAL File Lifecycle

| Stage | enx.db-wal State | Action |
|-------|------------------|--------|
| **1. First write** | Created, empty | File created |
| **2. Accumulating writes** | Growing (0 → 4MB) | Append frames |
| **3. Reach threshold** | 4MB (1000 pages) | Auto-checkpoint triggered |
| **4. After checkpoint** | File exists, reused | Content overwritten from start |
| **5. More writes** | Growing again | Reuses same file |
| **6. Database close** | May be kept/deleted | Depends on content |

**Key Points**:

✅ **写入时机**: 每次 INSERT/UPDATE/DELETE 都立即写入 WAL
✅ **回收时机**: WAL 达到阈值时自动 checkpoint（定期回收）
✅ **文件处理**: WAL 文件不删除，而是**重用**（覆盖写）
✅ **真正删除**: 只有 TRUNCATE checkpoint 或切换 journal mode 才物理删除内容

### Configuration Options

```sql
-- Enable WAL mode (one-time, persists in database)
PRAGMA journal_mode=WAL;

-- Synchronous mode (durability vs performance)
PRAGMA synchronous=FULL;      -- Maximum durability, slower
PRAGMA synchronous=NORMAL;    -- Good balance (recommended)
PRAGMA synchronous=OFF;       -- Fastest, risk data loss

-- Busy timeout (wait for locks)
PRAGMA busy_timeout=5000;     -- Wait 5 seconds

-- Page size (affects performance)
PRAGMA page_size=4096;        -- Default, good for most cases

-- Cache size (memory for pages)
PRAGMA cache_size=-2000;      -- 2MB cache
```

### Performance Characteristics

| Operation | Traditional | WAL | Improvement |
|-----------|-------------|-----|-------------|
| **Small writes** | 10-20/sec | 50-100/sec | **5x faster** |
| **Large writes** | 100 MB/sec | 150 MB/sec | **1.5x faster** |
| **Concurrent reads** | Blocked | Never blocked | **∞** |
| **Read latency** | Low | Slightly higher* | 5-10% slower |
| **Storage** | 1x | 1.3x** | +30% during peak |

*Readers must check both database and WAL
**WAL file size before checkpoint

### Limitations and Considerations

#### ❌ 1. Not Recommended for Network File Systems

```
Problem: WAL requires POSIX advisory locking
         Network file systems (NFS, SMB) may not support properly

Solution: Use local disk for database files
          (Your P2P design already does this ✅)
```

#### ❌ 2. All Connections Must Use WAL

```
Problem: If one connection uses WAL, all must use WAL
         Mixed mode not supported

Solution: Enable WAL once, all connections inherit
          (Not an issue in your design ✅)
```

#### ⚠️ 3. Checkpoint Blocking

```
Scenario: Large WAL file + many readers
          Checkpoint must wait for all readers to finish

Mitigation: Use PASSIVE checkpoint (doesn't block)
            Acceptable WAL size (a few MB is fine)
```

#### ⚠️ 4. Read Performance

```
Readers must check: enx.db + enx.db-wal
                    Slightly slower than single file

Impact: ~5-10% slower reads (negligible for your use case)
```

### Best Practices

#### 1. **Always Enable WAL for Modern Apps**

```go
db, _ := sql.Open("sqlite3", "enx.db")
db.Exec("PRAGMA journal_mode=WAL")
db.Exec("PRAGMA synchronous=NORMAL")
db.Exec("PRAGMA busy_timeout=5000")
```

#### 2. **Monitor WAL Size**

```go
func checkWALSize(db *sql.DB) {
    var walPages int
    db.QueryRow("PRAGMA wal_checkpoint(PASSIVE)").Scan(&walPages)

    if walPages > 10000 {  // > 40MB
        log.Warn("WAL file too large, forcing checkpoint")
        db.Exec("PRAGMA wal_checkpoint(RESTART)")
    }
}
```

#### 3. **Backup Strategy**

```bash
# ❌ Wrong: Copy database while WAL active
cp enx.db backup.db  # Missing changes in WAL!

# ✅ Correct: Checkpoint first
sqlite3 enx.db "PRAGMA wal_checkpoint(TRUNCATE)"
cp enx.db backup.db
cp enx.db-wal backup.db-wal  # Optional, usually empty after TRUNCATE
```

#### 4. **Checkpoint Timing**

```go
// Checkpoint during low activity
ticker := time.NewTicker(5 * time.Minute)
go func() {
    for range ticker.C {
        if isLowActivity() {
            db.Exec("PRAGMA wal_checkpoint(PASSIVE)")
        }
    }
}()
```

### WAL Integration for P2P Sync

### ⚠️ CRITICAL: Why NOT Use WAL File Directly for Sync

**❌ WAL 文件本身不适合作为同步机制**

Before discussing how to **leverage** WAL mode for performance, it's crucial to understand why you should **NOT** use the WAL file itself as a sync mechanism:

#### Problem 1: Unpredictable Checkpoint Timing

**WAL 合并时机不可控**

```
WAL checkpoint can happen at ANY time:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Automatic checkpoints:
   - Every 1000 pages (4MB) by default
   - On last connection close
   - On transaction commit (if threshold reached)
   - On system events (memory pressure, etc.)

❌ You cannot reliably predict WHEN checkpoint happens:

Timeline:
T0:   Write change A → WAL contains [A]
T1:   Write change B → WAL contains [A, B]
T2:   💥 Auto-checkpoint! → WAL cleared, changes merged to DB
T3:   Try to sync WAL → ❌ Changes A, B already gone!

Host A: Writes 10 changes → Auto-checkpoint → WAL cleared
Host B: Tries to read WAL from cloud → ❌ Missing changes 1-10
Host C: Has different checkpoint timing → Inconsistent state
```

**Example of the Problem**

```go
// Host A (Desktop)
for i := 0; i < 100; i++ {
    db.Exec("INSERT INTO words VALUES (...)")
}
// After ~1000 pages → Auto-checkpoint triggered
// WAL file cleared, changes merged to enx.db

// Host B (MacBook) tries to sync
file := downloadFromCloud("enx.db-wal")
// ❌ WAL file is empty or has different content!
// ❌ Missing changes from Host A
// ❌ Sync fails or gets partial data
```

#### Problem 2: No Historical Record

**WAL 文件不保留历史**

```
WAL is a TEMPORARY buffer, not a change log:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Traditional change log (what you need for sync):
┌────────────────────────────────────────────────────────┐
│ Change 1: 2025-11-01 10:00 - Insert word "hello"      │
│ Change 2: 2025-11-01 10:05 - Update word "world"      │
│ Change 3: 2025-11-02 14:30 - Insert word "goodbye"    │
│ ...                                                    │
│ Change 100: 2025-11-10 09:15 - Delete word "test"     │
│                                                         │
│ ✅ All changes preserved                                │
│ ✅ Can replay any subset                                │
│ ✅ Can sync incrementally                               │
└────────────────────────────────────────────────────────┘

WAL file (NOT a change log):
┌────────────────────────────────────────────────────────┐
│ Page 1: [current data]                                 │
│ Page 2: [current data]                                 │
│ Page 3: [current data]                                 │
│ ...                                                     │
│ 💥 Checkpoint → All cleared                             │
│                                                         │
│ ❌ No historical changes                                │
│ ❌ Cannot replay past changes                           │
│ ❌ Cannot do incremental sync                           │
└────────────────────────────────────────────────────────┘

Problem:
- WAL only contains UNCOMMITTED or RECENT changes
- After checkpoint, old changes are GONE FOREVER
- No way to retrieve "changes since last sync"
```

#### Problem 3: No Access API

**无法可靠读取 WAL 内容**

```
SQLite does NOT provide API to read WAL content:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ No API to:
   - List changes in WAL
   - Extract change records
   - Replay WAL to another database
   - Query WAL content

❌ WAL file format is internal:
   - Binary format (not human-readable)
   - Page-level data (not record-level)
   - No guarantees across SQLite versions
   - Not designed for external consumption

❌ Even if you parse WAL manually:
   - Complex binary format
   - Requires deep SQLite internals knowledge
   - Breaks on SQLite updates
   - No official documentation
```

#### Problem 4: Offline Sync Impossible

**离线同步无法实现**

```
Your P2P scenario requires offline capability:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reality with WAL-based sync:

Host A (Desktop):
  Day 1: Add 50 words → WAL grows → Auto-checkpoint → WAL cleared
  Day 2: Add 30 words → WAL grows → Auto-checkpoint → WAL cleared
  Day 3: Upload WAL to cloud → ❌ Only contains Day 3 changes!
                              → ❌ Day 1-2 changes lost!

Host B (MacBook, offline for 2 days):
  Day 1-2: No network, can't sync
  Day 3: Come online, download WAL → ❌ Missing 50 + 30 words from Day 1-2

Host C (Ubuntu, isolated network):
  Week 1: Work offline entirely
  Week 2: Connect to sync → ❌ WAL checkpointed many times
                           → ❌ All changes lost except recent ones
```

#### Problem 5: Conflict Resolution Impossible

**无法解决冲突**

```
Conflict resolution requires change tracking:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What you need:
┌────────────────────────────────────────────────────────┐
│ Host A: Update word "hello" at 2025-11-01 10:00       │
│ Host B: Update word "hello" at 2025-11-01 10:05       │
│                                                         │
│ Conflict: Same word updated on both hosts              │
│ Resolution: Keep newer timestamp (Host B)              │
│                                                         │
│ ✅ Requires: Timestamp metadata for each change        │
└────────────────────────────────────────────────────────┘

What WAL provides:
┌────────────────────────────────────────────────────────┐
│ Page 42: [raw binary data for word "hello"]           │
│                                                         │
│ ❌ No timestamp                                         │
│ ❌ No change metadata                                   │
│ ❌ Cannot determine which change is newer              │
│ ❌ Cannot resolve conflicts                            │
└────────────────────────────────────────────────────────┘
```

#### The Right Approach: Timestamp-Based Sync

**✅ Correct approach: Timestamp fields + WAL mode**

```
Separate concerns:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. WAL Mode → For performance (fast writes, no blocking)
   ├─ Enable: PRAGMA journal_mode=WAL
   ├─ Benefit: 5x faster writes, concurrent reads
   └─ Purpose: Improve app performance

2. Timestamp Fields → For sync mechanism
   ├─ Schema: update_datetime, update_time in every table
   ├─ Benefit: Reliable change tracking, conflict resolution
   └─ Purpose: Track changes for P2P sync

Best of both worlds:
┌────────────────────────────────────────────────────────┐
│ ✅ WAL enabled → Fast, concurrent operations           │
│ ✅ Timestamp tracking → Reliable sync mechanism        │
│ ✅ No dependency on WAL file → Predictable behavior    │
│ ✅ Offline support → Changes tracked even when offline │
│ ✅ Conflict resolution → Timestamp comparison          │
└────────────────────────────────────────────────────────┘
```

#### Comparison: WAL-Based vs Timestamp-Based Sync

| Aspect | WAL File as Sync | Timestamp Fields | Winner |
|--------|------------------|------------------|---------|
| **Checkpoint timing** | ❌ Unpredictable, data loss | ✅ Always preserved | ✅ Timestamp |
| **Historical record** | ❌ Cleared after checkpoint | ✅ Permanent record | ✅ Timestamp |
| **Offline support** | ❌ Loses old changes | ✅ All changes tracked | ✅ Timestamp |
| **Conflict resolution** | ❌ No metadata | ✅ Timestamp comparison | ✅ Timestamp |
| **API availability** | ❌ No public API | ✅ Standard SQL | ✅ Timestamp |
| **Reliability** | ❌ Fragile, timing-dependent | ✅ Solid, predictable | ✅ Timestamp |
| **Performance boost** | N/A | ✅ WAL mode enabled | ✅ Both |
| **Implementation** | ❌ Complex, hacky | ✅ Simple, standard | ✅ Timestamp |

#### Summary: Use WAL Mode, Don't Sync WAL File

```
The winning strategy:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ DO:
   - Enable WAL mode for performance
   - Use timestamp fields for sync mechanism
   - Sync main DB file (enx.db) to cloud
   - Compare timestamps to detect changes
   - Merge changes based on timestamps

❌ DON'T:
   - Try to sync WAL file
   - Depend on WAL file for change tracking
   - Parse WAL file manually
   - Use WAL as a "change log"
   - Expect WAL file to contain historical changes

Key insight:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WAL is a PERFORMANCE feature, not a SYNC mechanism.
Use it for speed, not for tracking changes.
```

---

### Why Use WAL Mode?

SQLite's Write-Ahead Logging (WAL) mode is **highly beneficial** for this P2P sync architecture:

#### 1. Concurrent Read-Write Operations

**Traditional Mode (DELETE journal)**:
```
Sync process reading changes → ❌ BLOCKS user operations
User writing new word       → ❌ BLOCKS sync reading
Result: Poor performance, frequent locks
```

**WAL Mode**:
```
Sync process reading changes → ✅ Continues
User writing new word       → ✅ Continues simultaneously
Background sync             → ✅ No interruption to users
Result: Smooth operation, no blocking
```

#### 2. Atomic Batch Sync

WAL ensures atomic commits for sync operations:

```go
// Sync a batch of 100 changes atomically
tx, err := db.Begin()
defer tx.Rollback()

for _, change := range changes {
    // Apply change
    if err := applyChange(tx, change); err != nil {
        // ✅ Entire batch rolls back automatically
        // No partial sync, no inconsistent state
        return err
    }
}

tx.Commit()  // ✅ All 100 changes commit atomically
```

#### 3. Performance Benefits

| Operation | Traditional Mode | WAL Mode | Improvement |
|-----------|------------------|----------|-------------|
| Small writes | ~10 writes/sec | ~50 writes/sec | **5x faster** |
| Concurrent reads | Blocked during write | Never blocked | **∞ improvement** |
| Sync throughput | 100 records/sec | 500 records/sec | **5x faster** |
| Checkpoint | N/A | Auto background | No manual work |

### Implementation

#### 1. Enable WAL Mode

```go
// enx-data-service database initialization
func InitDatabase(dbPath string) (*sql.DB, error) {
    db, err := sql.Open("sqlite3", dbPath)
    if err != nil {
        return nil, err
    }

    // ✅ Enable WAL mode
    _, err = db.Exec("PRAGMA journal_mode=WAL")
    if err != nil {
        return nil, fmt.Errorf("failed to enable WAL: %w", err)
    }

    // ✅ Configure WAL checkpoint interval
    // Auto-checkpoint when WAL reaches 1000 pages (~4MB)
    _, err = db.Exec("PRAGMA wal_autocheckpoint=1000")
    if err != nil {
        return nil, err
    }

    // ✅ Set synchronous mode for durability/performance balance
    // NORMAL mode: Fast, safe for most use cases
    // FULL mode: Slower but maximum durability
    _, err = db.Exec("PRAGMA synchronous=NORMAL")
    if err != nil {
        return nil, err
    }

    // ✅ Set busy timeout for better concurrency handling
    _, err = db.Exec("PRAGMA busy_timeout=5000")  // 5 seconds
    if err != nil {
        return nil, err
    }

    log.Info("SQLite WAL mode enabled successfully")
    return db, nil
}
```

#### 2. WAL-Aware Sync Algorithm

```go
// Leverage WAL for efficient sync operations
func (s *SyncService) ApplyChanges(changes []Change) error {
    // ✅ Start transaction (uses WAL)
    tx, err := s.db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // ✅ Batch apply changes
    for _, change := range changes {
        switch change.Action {
        case "insert":
            if err := s.insertRecord(tx, change); err != nil {
                // WAL ensures entire batch rolls back
                return err
            }
        case "update":
            if err := s.updateRecord(tx, change); err != nil {
                return err
            }
        case "delete":
            if err := s.deleteRecord(tx, change); err != nil {
                return err
            }
        }
    }

    // ✅ Atomic commit (all or nothing)
    if err := tx.Commit(); err != nil {
        return err
    }

    log.Infof("Applied %d changes atomically", len(changes))
    return nil
}
```

#### 3. WAL Checkpoint Management

```go
// Manual checkpoint control (optional, usually automatic)
func (s *SyncService) CheckpointWAL() error {
    // Checkpoint types:
    // PASSIVE: Don't block, checkpoint what's possible
    // FULL: Wait for readers to finish, checkpoint everything
    // RESTART: FULL + start new WAL file
    // TRUNCATE: RESTART + truncate old WAL file to 0 bytes

    _, err := s.db.Exec("PRAGMA wal_checkpoint(PASSIVE)")
    if err != nil {
        return fmt.Errorf("WAL checkpoint failed: %w", err)
    }

    log.Info("WAL checkpoint completed")
    return nil
}

// Periodic checkpoint (runs in background)
func (s *SyncService) StartWALCheckpointWorker() {
    ticker := time.NewTicker(5 * time.Minute)
    defer ticker.Stop()

    for range ticker.C {
        if err := s.CheckpointWAL(); err != nil {
            log.Warnf("Background checkpoint failed: %v", err)
        }
    }
}
```

### WAL File Management

#### File Structure

```
/data/
├── enx.db           # Main database file
├── enx.db-wal       # Write-Ahead Log (transactions)
└── enx.db-shm       # Shared memory (coordination)
```

#### Important Considerations

**1. Backup Strategy**:
```bash
# ❌ Wrong: Copy only enx.db
cp enx.db enx-backup.db  # Missing uncommitted changes in WAL!

# ✅ Correct: Checkpoint first, then copy
sqlite3 enx.db "PRAGMA wal_checkpoint(TRUNCATE)"
cp enx.db enx-backup.db
```

**2. Sync Strategy (for P2P)**:
```go
// Option A: Sync database file + WAL file together
func (s *SyncService) PrepareForSync() error {
    // Checkpoint to merge WAL into main database
    _, err := s.db.Exec("PRAGMA wal_checkpoint(RESTART)")
    return err
}

// Option B: Use enx-data-service API (recommended)
// Don't sync files directly, sync through gRPC API
// enx-data-service handles WAL internally
```

**3. Multi-Process Access**:
```
✅ Safe: Multiple read-only processes
✅ Safe: One writer + multiple readers
❌ Unsafe: Multiple writers (not needed in P2P design)
```

### Integration with P2P Sync

#### Sync Process with WAL

```
Step 1: Node A requests changes from Node B
┌────────┐                            ┌────────┐
│ Node A │─── GetChanges(since) ────→│ Node B │
│        │                            │        │
│        │                            │ (WAL)  │
│        │                            │ Read   │
│        │                            │ changes│
│        │←─── Stream: 100 changes ──│ ✅ No  │
│        │                            │ block  │
└────────┘                            └────────┘

Step 2: Node A applies changes locally
┌────────┐
│ Node A │
│        │ tx.Begin()              ← WAL transaction
│        │ Apply 100 changes       ← In-memory
│        │ tx.Commit()             ← WAL atomic write
│        │ ✅ Success or rollback
└────────┘

Step 3: Background checkpoint (automatic)
┌────────┐
│ Node A │
│        │ [5 minutes later]
│        │ Checkpoint WAL          ← Merge to main DB
│        │ ✅ No interruption to users
└────────┘
```

#### Why WAL is Perfect for P2P Sync

1. **Non-blocking sync**: Sync operations don't block user operations
2. **Atomic batches**: Entire sync batch commits or rolls back together
3. **Better performance**: Faster writes, no lock contention
4. **Crash recovery**: WAL provides automatic recovery
5. **No manual intervention**: Auto-checkpoint handles WAL size

### Configuration Best Practices

```yaml
# Environment variables for enx-data-service
environment:
  # Database
  - DB_PATH=/data/enx.db
  - DB_WAL_MODE=true                    # Enable WAL
  - DB_WAL_AUTOCHECKPOINT=1000          # Pages before auto-checkpoint
  - DB_SYNCHRONOUS=NORMAL               # Balance durability/performance
  - DB_BUSY_TIMEOUT=5000                # Wait 5s on busy

  # Sync
  - SYNC_INTERVAL=300                   # 5 minutes
  - SYNC_BATCH_SIZE=100                 # Records per transaction

  # Checkpoint
  - WAL_CHECKPOINT_INTERVAL=300         # 5 minutes
  - WAL_CHECKPOINT_TYPE=PASSIVE         # Non-blocking
```

### Monitoring WAL Health

```go
// Check WAL statistics
func (s *SyncService) GetWALStats() (*WALStats, error) {
    var stats WALStats

    // Get WAL file size
    row := s.db.QueryRow(`
        SELECT
            page_count * page_size / 1024 / 1024 as wal_size_mb,
            (SELECT page_count FROM pragma_page_count()) as db_pages
        FROM pragma_wal_checkpoint('PASSIVE')
    `)

    err := row.Scan(&stats.WALSizeMB, &stats.DBPages)
    if err != nil {
        return nil, err
    }

    return &stats, nil
}

// Alert if WAL grows too large (indicates checkpoint issues)
func (s *SyncService) MonitorWALSize() {
    ticker := time.NewTicker(1 * time.Minute)
    defer ticker.Stop()

    for range ticker.C {
        stats, err := s.GetWALStats()
        if err != nil {
            log.Errorf("Failed to get WAL stats: %v", err)
            continue
        }

        // Alert if WAL exceeds 100MB (adjust based on workload)
        if stats.WALSizeMB > 100 {
            log.Warnf("WAL file too large: %.2f MB", stats.WALSizeMB)
            // Trigger manual checkpoint
            s.CheckpointWAL()
        }
    }
}
```

### Advantages Summary

| Feature | Benefit for P2P Sync |
|---------|----------------------|
| **Concurrent access** | Sync doesn't block user operations |
| **Atomic transactions** | Entire sync batch commits or fails |
| **Better performance** | 5x faster writes during sync |
| **Auto-checkpoint** | No manual WAL management needed |
| **Crash recovery** | Automatic recovery from interrupted sync |
| **Read consistency** | Readers see consistent snapshot |

### Potential Issues & Solutions

#### Issue 1: WAL File Growth

**Problem**: WAL file grows indefinitely if checkpoint fails
**Solution**:
```go
// Monitor and force checkpoint if needed
if walSize > 100*1024*1024 {  // 100MB
    db.Exec("PRAGMA wal_checkpoint(RESTART)")
}
```

#### Issue 2: NFS/Network Drives

**Problem**: WAL mode not recommended on NFS
**Solution**:
- Use local disk for each node's enx.db
- Sync via gRPC API, not file copying
- This design already does this ✅

#### Issue 3: Checkpoint Blocking

**Problem**: FULL/RESTART checkpoints wait for readers
**Solution**:
- Use PASSIVE checkpoint (default)
- Checkpoint during low-activity periods
- Acceptable WAL size is fine (auto-managed)

## SQLite Session Extension Alternative

### What is Session Extension?

SQLite Session Extension is an **official SQLite module** for capturing and replaying database changes. It's designed specifically for **replication and synchronization** scenarios.

**Official Documentation**: https://www.sqlite.org/sessionintro.html

### Core Concepts

#### 1. **Session Object**

Tracks all changes to specified tables during a session:

```c
sqlite3_session *pSession;

// Create session
sqlite3_session_create(db, "main", &pSession);

// Attach tables to track
sqlite3_session_attach(pSession, "words");
sqlite3_session_attach(pSession, "user_dicts");

// ... perform INSERT/UPDATE/DELETE operations ...

// Extract changeset
int nChangeset;
void *pChangeset;
sqlite3_session_changeset(pSession, &nChangeset, &pChangeset);
```

#### 2. **Changeset**

Binary format containing all changes:

```
Changeset contains:
- Table name
- Action (INSERT, UPDATE, DELETE)
- Old values (for UPDATE/DELETE)
- New values (for INSERT/UPDATE)
- Primary key information
```

#### 3. **Apply Changeset**

Replay changes on another database:

```c
// Apply changeset to another database
sqlite3_changeset_apply(
    db2,                    // Target database
    nChangeset,             // Changeset size
    pChangeset,             // Changeset data
    filter_callback,        // Optional filter
    conflict_callback,      // Conflict handler
    NULL                    // User data
);
```

### How It Works

```
Node A                          Node B
┌─────────────────┐            ┌─────────────────┐
│  1. Create      │            │                 │
│     Session     │            │                 │
│                 │            │                 │
│  2. Track       │            │                 │
│     Changes     │            │                 │
│     - INSERT    │            │                 │
│     - UPDATE    │            │                 │
│     - DELETE    │            │                 │
│                 │            │                 │
│  3. Generate    │            │                 │
│     Changeset   │            │                 │
│     (binary)    │            │                 │
└────────┬────────┘            └────────┬────────┘
         │                              │
         │  4. Transfer Changeset       │
         │     (gRPC/HTTP/File)         │
         └─────────────────────────────>│
                                        │
                                 5. Apply
                                    Changeset
                                        │
                                 6. Resolve
                                    Conflicts
```

### Go Implementation (with CGo)

#### Installation

```bash
# Install go-sqlite3 with session extension
go get github.com/mattn/go-sqlite3

# Need to enable CGO
export CGO_ENABLED=1
```

#### Code Example

```go
package main

import (
    "database/sql"
    "unsafe"

    "github.com/mattn/go-sqlite3"
)

/*
#cgo LDFLAGS: -lsqlite3
#include <sqlite3.h>
#include <stdlib.h>
*/
import "C"

type SessionManager struct {
    db      *sql.DB
    session *C.sqlite3_session
}

// Create session and attach tables
func NewSession(db *sql.DB) (*SessionManager, error) {
    // Get raw SQLite connection
    conn, err := db.Conn(context.Background())
    if err != nil {
        return nil, err
    }

    var session *C.sqlite3_session
    var sqliteDB *C.sqlite3

    // Extract native handle (using go-sqlite3 internal API)
    conn.Raw(func(driverConn interface{}) error {
        sqliteConn := driverConn.(*sqlite3.SQLiteConn)
        // ... extract native handle ...
        return nil
    })

    // Create session
    rc := C.sqlite3_session_create(sqliteDB, C.CString("main"), &session)
    if rc != C.SQLITE_OK {
        return nil, fmt.Errorf("failed to create session: %d", rc)
    }

    // Attach tables
    C.sqlite3_session_attach(session, C.CString("words"))
    C.sqlite3_session_attach(session, C.CString("user_dicts"))
    C.sqlite3_session_attach(session, C.CString("users"))

    return &SessionManager{db: db, session: session}, nil
}

// Capture changes
func (sm *SessionManager) GetChangeset() ([]byte, error) {
    var nChangeset C.int
    var pChangeset *C.void

    rc := C.sqlite3_session_changeset(sm.session, &nChangeset, &pChangeset)
    if rc != C.SQLITE_OK {
        return nil, fmt.Errorf("failed to get changeset: %d", rc)
    }
    defer C.sqlite3_free(pChangeset)

    // Convert to Go bytes
    changeset := C.GoBytes(pChangeset, nChangeset)
    return changeset, nil
}

// Apply changeset to database
func ApplyChangeset(db *sql.DB, changeset []byte) error {
    var sqliteDB *C.sqlite3
    // ... get native handle ...

    rc := C.sqlite3_changeset_apply(
        sqliteDB,
        C.int(len(changeset)),
        unsafe.Pointer(&changeset[0]),
        nil,  // filter
        (*[0]byte)(C.conflictCallback),  // conflict handler
        nil,  // user data
    )

    if rc != C.SQLITE_OK {
        return fmt.Errorf("failed to apply changeset: %d", rc)
    }

    return nil
}

// Conflict resolution callback
//export conflictCallback
func conflictCallback(pCtx unsafe.Pointer, eConflict C.int, pIter *C.sqlite3_changeset_iter) C.int {
    switch eConflict {
    case C.SQLITE_CHANGESET_DATA:
        // Data conflict: remote and local both modified
        // Strategy: Keep newer version based on timestamp
        return C.SQLITE_CHANGESET_REPLACE

    case C.SQLITE_CHANGESET_NOTFOUND:
        // Record not found: remote deleted, local modified
        return C.SQLITE_CHANGESET_OMIT

    case C.SQLITE_CHANGESET_CONFLICT:
        // Primary key conflict
        return C.SQLITE_CHANGESET_REPLACE

    default:
        return C.SQLITE_CHANGESET_ABORT
    }
}
```

### Integration with P2P Sync

#### Workflow

```go
// Node A: Capture changes
session, _ := NewSession(db)

// ... user performs operations ...
db.Exec("INSERT INTO words ...")
db.Exec("UPDATE user_dicts ...")

// Extract changeset
changeset, _ := session.GetChangeset()

// Send to Node B via gRPC
client.PushChangeset(context.Background(), &pb.Changeset{
    Data: changeset,
    Timestamp: time.Now().Format(time.RFC3339),
})

// Node B: Apply changeset
ApplyChangeset(db, changeset)
```

#### gRPC Service Definition

```protobuf
service SyncService {
  rpc PushChangeset(ChangesetRequest) returns (ChangesetResponse);
  rpc PullChangesets(PullRequest) returns (stream ChangesetRequest);
}

message ChangesetRequest {
  string node_id = 1;
  bytes data = 2;          // Binary changeset
  string timestamp = 3;
  int32 sequence = 4;      // Ordering
}

message ChangesetResponse {
  bool success = 1;
  string error = 2;
  int32 conflicts_resolved = 3;
}
```

### Advantages of Session Extension

| Feature | Benefit |
|---------|---------|
| **Official SQLite** | Maintained by SQLite team, stable API |
| **Efficient format** | Binary changeset, smaller than JSON |
| **Automatic tracking** | No manual change recording needed |
| **Conflict resolution** | Built-in callback mechanism |
| **Incremental** | Only captures changes, not full snapshot |
| **Type-safe** | Preserves data types correctly |

### Disadvantages

| Issue | Impact |
|-------|--------|
| **Requires CGo** | Complex build process, platform-dependent |
| **Session is in-memory** | Lost on process restart |
| **No persistence** | Need external storage for changesets |
| **Learning curve** | C API, not idiomatic Go |
| **No automatic replay** | Need to implement transport layer |

### Comparison: Session Extension vs Timestamp-based

#### Session Extension Approach

```go
✅ Automatic change tracking
session.attach("words")  // Tracks all changes

✅ Efficient binary format
changeset size: ~100 bytes per change

✅ Built-in conflict resolution
Callback handles conflicts automatically

❌ Requires CGo
Complex build, platform issues

❌ Session doesn't persist
Restart = lose tracking state

❌ Need changeset storage
Must save changesets somewhere
```

#### Timestamp-based Approach (Current)

```go
✅ Simple SQL queries
SELECT * FROM words WHERE update_datetime > ?

✅ Pure Go
No CGo, cross-platform

✅ Persistent tracking
Timestamps in database, survive restarts

✅ Easy debugging
Direct SQL queries, human-readable

❌ Manual timestamp management
Need to add update_datetime to each table

❌ Larger transfer size
Full records vs binary diffs
```

### Critical Limitations for Your Use Case

#### ⚠️ Problem 1: Session Doesn't Survive Restarts

**Session Extension fatal flaw for development environments**:

```
Scenario: Development on Desktop
─────────────────────────────────────────────────────────
10:00 AM - Start enx-data-service
           session = sqlite3_session_create()  ← Session in memory

10:30 AM - Add 50 words
           session tracks changes              ← 50 changes in memory

11:00 AM - Reboot computer for kernel update
           ❌ Process killed
           ❌ Session destroyed
           ❌ 50 word changes LOST

11:30 AM - Start enx-data-service again
           session = sqlite3_session_create()  ← NEW empty session
           session has no history              ← Cannot get 10:30 changes

Result: MacBook will NEVER receive those 50 words!
```

**Root cause**:
- Session lives in **process memory**
- Not persisted to disk
- Restart = complete loss of tracking state

**Workaround complexity**:
```go
// Would need to persist changesets before every potential restart:
session.GetChangeset()           // Extract changes
db.Exec("INSERT INTO changesets ...") // Persist to disk

// On restart:
rows := db.Query("SELECT * FROM changesets WHERE not_synced = 1")
// Manually reconstruct and send changesets

// This defeats the purpose of using Session Extension!
// Might as well use timestamp-based approach directly.
```

#### ⚠️ Problem 2: Offline Sync Impossible

**Your scenario (Ubuntu isolated environment)**:

```
Friday - Ubuntu (offline):
─────────────────────────────────────────────────────────
Start enx-data-service → session.create()
Add 30 words           → session tracks (in memory)
                       → ❌ Cannot sync (no network)
Shutdown for weekend   → ❌ Session destroyed
                       → ❌ 30 words tracking LOST

Monday - Ubuntu (back online):
─────────────────────────────────────────────────────────
Start enx-data-service → NEW session.create()
Try to sync            → ❌ No changeset available
                       → ❌ 30 words never sync to Desktop/MacBook

Desktop/MacBook:
Never receive the 30 words from Ubuntu
```

**Why timestamp-based works**:
```sql
-- Timestamps are IN THE DATABASE (persistent)
Friday  - Ubuntu: INSERT INTO words (english, update_datetime) VALUES (...)
Weekend - Ubuntu: Offline (data safe in database)
Monday  - Ubuntu: SELECT * FROM words WHERE update_datetime > last_sync
                  ✅ Gets all 30 words added on Friday
                  ✅ Syncs to Desktop/MacBook successfully
```

### When to Use Session Extension?

**Good fit (NONE apply to your project)**:
- ✅ High-frequency changes (thousands/sec)
  - Your case: Human usage, maybe 10 words/day ❌
- ✅ Large records (minimize transfer size)
  - Your case: Small records (~200 bytes each) ❌
- ✅ Complex conflict resolution needs
  - Your case: Simple timestamp comparison ❌
- ✅ Real-time replication required
  - Your case: 5-minute sync interval is fine ❌
- ✅ **Long-running process (no restarts)**
  - Your case: Development environment, frequent restarts ❌
- ✅ Team comfortable with CGo
  - Your case: Prefer pure Go ❌

**Not a good fit (ALL apply to your project)**:
- ❌ **Development environment** → Frequent restarts kill sessions
- ❌ **Offline usage** → Session doesn't persist between online/offline cycles
- ❌ Simple schema (3 tables)
- ❌ Low change frequency (human usage)
- ❌ Need persistent change tracking
- ❌ Pure Go preference
- ❌ Simple timestamp-based solution already works perfectly

### Hybrid Approach: Session Extension + Storage

If you want to use Session Extension for your P2P sync:

```go
// 1. Capture changes with Session Extension
session := NewSession(db)
// ... perform operations ...
changeset, _ := session.GetChangeset()

// 2. Store changeset persistently
storeChangeset(changeset, sequence)

// 3. Sync with peers
for _, peer := range peers {
    changesets := getUnsentChangesets(peer)
    peer.PushChangesets(changesets)
}

// 4. Apply received changesets
for _, changeset := range receivedChangesets {
    ApplyChangeset(db, changeset)
}
```

**Storage table**:
```sql
CREATE TABLE changesets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    data BLOB NOT NULL,           -- Binary changeset
    timestamp TEXT NOT NULL,
    applied_to TEXT DEFAULT '',   -- CSV of peer IDs
    INDEX idx_sequence (sequence),
    INDEX idx_timestamp (timestamp)
);
```

### Recommendation for Your Project

**Stick with timestamp-based approach** because:

1. **Simplicity**: Pure Go, no CGo complexity
2. **Offline-friendly**: Timestamps persist in database
3. **Easy debugging**: SQL queries, human-readable
4. **Sufficient performance**: Your change frequency is low
5. **Already implemented**: Working solution exists
6. **Restart-safe**: Survives process restarts (Session Extension doesn't)
7. **Offline-safe**: Works across offline/online cycles (Session Extension doesn't)

Session Extension would add complexity without significant benefits for your use case.

## Litestream Analysis

### What is Litestream?

**Litestream** is a popular community tool for **streaming replication** of SQLite databases to cloud storage (S3, Azure Blob, GCS, etc.).

**Official Site**: https://litestream.io/

### How Litestream Works

```
Primary Node (Desktop)
┌─────────────────────────┐
│ enx-api                 │
│   ↓                     │
│ enx.db (SQLite + WAL)   │
│   ↓                     │
│ Litestream (monitor)    │ ← Monitors WAL file changes
└──────────┬──────────────┘
           │ Stream WAL frames
           ↓
┌─────────────────────────┐
│   S3 / Cloud Storage    │
│   - enx.db snapshot     │
│   - WAL frames (000001) │
│   - WAL frames (000002) │
│   - ...                 │
└──────────┬──────────────┘
           │ Restore command
           ↓
┌─────────────────────────┐
│ Standby Node (MacBook)  │
│ litestream restore      │
│   ↓                     │
│ enx.db (restored)       │
└─────────────────────────┘
```

### Critical Limitation: No Bidirectional Sync

#### ❌ Problem: Single Writer Only

**Litestream is designed for disaster recovery, NOT multi-node sync**:

```
✅ Supported (Primary-Standby):
Primary (Desktop)  → Litestream → S3 → Restore → Standby (MacBook)
   [WRITE]                                          [READ-ONLY]

❌ NOT Supported (Multi-Master):
Desktop ←→ S3 ←→ MacBook
 [WRITE]        [WRITE]
   ↓              ↓
 Conflict!    Overwrite!
```

#### Your Use Case Analysis

**What you need**:
```
Monday - Desktop:
  - Add 50 words
  - Sync to MacBook ✅ Want this

Friday - MacBook (traveling):
  - Add 20 words
  - Sync to Desktop ✅ Want this

Weekend - Ubuntu laptop (isolated):
  - Add 30 words (offline)
  - Later sync to Desktop/MacBook ✅ Want this
```

**What Litestream provides**:
```
Desktop → S3 → MacBook  ✅ Desktop to MacBook works
MacBook → S3 → Desktop  ❌ OVERWRITES Desktop's data!

Problem: Last writer wins, no merge logic
```

**Detailed failure scenario**:
```
Step 1: Desktop adds 50 words
────────────────────────────────────────────────
Desktop: enx.db (1000 words + 50 new = 1050 words)
Litestream: Replicates to S3
S3: enx.db (1050 words)

Step 2: MacBook restores from S3
────────────────────────────────────────────────
MacBook: litestream restore
MacBook: enx.db (1050 words) ✅ Correct

Step 3: MacBook adds 20 words (offline)
────────────────────────────────────────────────
MacBook: enx.db (1050 + 20 = 1070 words)
Desktop: still has 1050 words

Step 4: MacBook comes online, replicates to S3
────────────────────────────────────────────────
MacBook: litestream replicate → S3
S3: enx.db (1070 words) ← Overwrites!

Step 5: Desktop restores from S3
────────────────────────────────────────────────
Desktop: litestream restore
Desktop: enx.db (1070 words)
Desktop: ❌ Lost local changes made after Step 1!

Result: Data loss if both nodes write
```

### Why Litestream Can't Do P2P Sync

**Architecture reasons**:

1. **No conflict resolution**:
   - Litestream just copies database files
   - No logic to merge changes from multiple sources
   - Last write wins = data loss

2. **Designed for failover, not collaboration**:
   ```
   Intended use case:
   - Primary fails → Standby takes over
   - New primary replicates to S3
   - Old primary is DISCARDED

   Your use case:
   - All nodes are active writers
   - Need to merge changes from all nodes
   - No node is discarded
   ```

3. **One-way stream**:
   - Litestream only streams Primary → Cloud
   - No built-in mechanism to pull and merge from cloud
   - Manual restore is full replacement, not incremental merge

### Could You Make Litestream Work?

**Theoretical workaround** (not recommended):

```bash
# Each node replicates to separate S3 paths
Desktop:  litestream replicate enx.db s3://bucket/desktop/enx.db
MacBook:  litestream replicate enx.db s3://bucket/macbook/enx.db
Ubuntu:   litestream replicate enx.db s3://bucket/ubuntu/enx.db

# Then manually merge (every sync):
litestream restore s3://bucket/macbook/enx.db -o /tmp/macbook.db
litestream restore s3://bucket/ubuntu/enx.db -o /tmp/ubuntu.db
./sync-db enx.db /tmp/macbook.db  # Your existing merge tool
./sync-db enx.db /tmp/ubuntu.db
litestream replicate enx.db s3://bucket/desktop/enx.db
```

**Why this is bad**:
- ❌ **Complexity**: Litestream + custom merge logic
- ❌ **Cost**: 3x storage (full database copy per node)
- ❌ **Bandwidth**: Downloading full databases every sync
- ❌ **Conflict window**: Race conditions between restore and replicate
- ❌ **No benefit**: Current solution (cloud folder + sync-db) is simpler

### Comparison: Litestream vs Current Solution

| Feature | Litestream | Current (Cloud Folder + sync-db) |
|---------|------------|----------------------------------|
| **P2P sync** | ❌ Single-writer only | ✅ Multi-node merge |
| **Bidirectional** | ❌ One-way only | ✅ Bidirectional |
| **Conflict resolution** | ❌ None (last write wins) | ✅ Timestamp-based merge |
| **Offline support** | ⚠️ Manual restore | ✅ Automatic on reconnect |
| **Setup complexity** | ⚠️ S3 + credentials | ✅ Just cloud folder |
| **Cost** | 💰 S3 storage + API calls | 💰 Included in Dropbox/Drive |
| **Data safety** | ⚠️ Data loss risk | ✅ Merge preserves all data |

### When to Use Litestream

**Good fit**:
- ✅ Single primary database with hot standby
- ✅ Disaster recovery / backup
- ✅ Point-in-time recovery
- ✅ Production environment (stable, long-running)
- ✅ One writer, multiple read replicas

**NOT a good fit (your case)**:
- ❌ Multiple active writers (Desktop, MacBook, Ubuntu)
- ❌ Bidirectional sync needed
- ❌ Offline-then-merge workflow
- ❌ Development environment (frequent restarts)
- ❌ Simple 3-node P2P sync

### Litestream Use Case Example (Not Your Scenario)

**Production blog site**:
```
Primary Server (us-east-1):
  - Handles all writes
  - Litestream → S3

If primary fails:
  1. Standby (us-west-2): litestream restore
  2. Standby becomes new primary
  3. Update DNS to point to new primary
  4. New primary: litestream → S3

Result: < 60 seconds downtime
```

This is **completely different** from your multi-node development scenario.

### Recommendation for Your Project

**Stick with timestamp-based approach** because:

1. **Simplicity**: Pure Go, no CGo complexity
2. **Offline-friendly**: Timestamps persist in database
3. **Easy debugging**: SQL queries, human-readable
4. **Sufficient performance**: Your change frequency is low
5. **Already implemented**: Working solution exists
6. **Restart-safe**: Survives process restarts (Session Extension doesn't)
7. **Offline-safe**: Works across offline/online cycles (Session Extension doesn't)
8. **True P2P**: All nodes can read and write (Litestream can't)
9. **No data loss**: Merge logic preserves all changes (Litestream overwrites)

Both Session Extension and Litestream would add complexity without benefits for your use case.

## cr-sqlite (CRDT-based SQLite) Analysis

### What is cr-sqlite?

**cr-sqlite** is a SQLite extension that adds **CRDT (Conflict-free Replicated Data Type)** capabilities to SQLite, enabling true multi-master replication with automatic conflict resolution.

**GitHub**: https://github.com/vlcn-io/cr-sqlite
**Organization**: vlcn.io (Voltron Data)

### Core Concept: CRDTs

**CRDT (Conflict-free Replicated Data Type)** is a mathematical approach to distributed data that guarantees:

- ✅ **Eventually consistent**: All nodes converge to same state
- ✅ **Conflict-free**: Mathematical properties ensure automatic merge
- ✅ **No coordination**: Nodes can work independently
- ✅ **Order independent**: Changes can be applied in any order

```
Traditional approach (your current):
Node A: update_datetime = 10:30 → Compare timestamps → Keep newer
Node B: update_datetime = 10:25 → Lost

CRDT approach:
Node A: version_vector = {A:5, B:3} → Merge vectors → Keep both
Node B: version_vector = {A:3, B:7} → Result: {A:5, B:7}
```

### How cr-sqlite Works

#### 1. **CRR Tables (Conflict-free Replicated Relations)**

Standard SQLite tables are converted to CRDT-enabled tables:

```sql
-- Create a CRDT table
CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    english TEXT NOT NULL,
    chinese TEXT
);

-- Enable CRDT tracking
SELECT crsql_as_crr('words');

-- cr-sqlite automatically adds metadata:
-- - __crsql_db_version (global version)
-- - __crsql_col_version (per-column version)
-- - __crsql_site_id (node identifier)
```

#### 2. **Version Vectors**

Every change is tracked with version information:

```sql
-- After enabling CRDT, internal structure:
words:
  id | english | chinese | __crsql_col_version | __crsql_site_id
  ---|---------|---------|---------------------|----------------
  1  | hello   | 你好    | {A:5, B:3}         | A
  2  | world   | 世界    | {A:3, B:7}         | B
```

#### 3. **Change Tracking**

cr-sqlite tracks changes at **column level**:

```sql
-- Query changes since version 10
SELECT * FROM crsql_changes WHERE db_version > 10;

Result:
table   | pk  | cid      | val   | col_version | db_version | site_id
--------|-----|----------|-------|-------------|------------|--------
words   | 1   | english  | hello | 5           | 15         | A
words   | 1   | chinese  | 你好  | 5           | 15         | A
words   | 2   | chinese  | 世界  | 7           | 16         | B
```

#### 4. **Automatic Merge**

When syncing between nodes:

```sql
-- Node A receives changes from Node B
INSERT INTO crsql_changes VALUES
  ('words', 2, 'chinese', '世界', 7, 16, 'B');

-- cr-sqlite automatically:
-- 1. Compares version vectors
-- 2. Merges if remote version is newer
-- 3. Keeps local if local version is newer
-- 4. No manual conflict resolution needed
```

### Architecture with cr-sqlite

```
Node A (Desktop)                    Node B (MacBook)
┌────────────────────┐             ┌────────────────────┐
│ enx.db + cr-sqlite │             │ enx.db + cr-sqlite │
│                    │             │                    │
│ words (CRDT)       │             │ words (CRDT)       │
│ - english: "hello" │             │ - english: "world" │
│ - version: {A:5}   │             │ - version: {B:7}   │
└────────┬───────────┘             └────────┬───────────┘
         │                                  │
         │ Pull changes (db_version > 5)   │
         │◄────────────────────────────────┤
         │ Push changes (db_version > 7)   │
         ├────────────────────────────────►│
         │                                  │
         │ After sync:                      │
         │ version: {A:5, B:7}              │
         │ Both have "hello" and "world"    │
         └──────────────────────────────────┘
```

### Code Example (Go with CGo)

```go
package main

import (
    "database/sql"
    "log"

    _ "github.com/mattn/go-sqlite3"
)

func main() {
    // Open database with cr-sqlite extension
    db, err := sql.Open("sqlite3", "enx.db?_extensions=crsqlite")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create table
    db.Exec(`CREATE TABLE IF NOT EXISTS words (
        id INTEGER PRIMARY KEY,
        english TEXT NOT NULL,
        chinese TEXT
    )`)

    // Enable CRDT tracking
    db.Exec(`SELECT crsql_as_crr('words')`)

    // Get current database version
    var dbVersion int64
    db.QueryRow(`SELECT crsql_db_version()`).Scan(&dbVersion)
    log.Printf("Current DB version: %d", dbVersion)

    // Insert data (automatically tracked)
    db.Exec(`INSERT INTO words (english, chinese) VALUES (?, ?)`,
        "hello", "你好")

    // Query changes since version 0 (all changes)
    rows, _ := db.Query(`SELECT * FROM crsql_changes WHERE db_version > 0`)
    defer rows.Close()

    for rows.Next() {
        var table, pk, cid, val string
        var colVer, dbVer int64
        var siteId string

        rows.Scan(&table, &pk, &cid, &val, &colVer, &dbVer, &siteId)
        log.Printf("Change: %s.%s = %s (version %d)", table, cid, val, dbVer)
    }
}

// Sync function: Pull changes from remote node
func syncFromRemote(db *sql.DB, remoteDB *sql.DB, lastSyncVersion int64) error {
    // Get changes from remote since last sync
    rows, err := remoteDB.Query(`
        SELECT "table", pk, cid, val, col_version, db_version, site_id
        FROM crsql_changes
        WHERE db_version > ?
    `, lastSyncVersion)
    if err != nil {
        return err
    }
    defer rows.Close()

    // Apply changes to local database
    stmt, _ := db.Prepare(`INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?)`)
    defer stmt.Close()

    for rows.Next() {
        var table, pk, cid, val string
        var colVer, dbVer int64
        var siteId string

        rows.Scan(&table, &pk, &cid, &val, &colVer, &dbVer, &siteId)

        // cr-sqlite automatically handles conflicts
        stmt.Exec(table, pk, cid, val, colVer, dbVer, siteId)
    }

    return nil
}
```

### Sync Protocol

```
┌─────────────────────────────────────────────────────────┐
│ P2P Sync with cr-sqlite                                 │
└─────────────────────────────────────────────────────────┘

Node A                           Node B
──────                           ──────
1. Get local version
   SELECT crsql_db_version()     → version: 15

2. Request changes from Node B
   "Send me changes since version 15"
                                 3. Query changes
                                    SELECT * FROM crsql_changes
                                    WHERE db_version > 15

                                 4. Send changes
   ◄─────────────────────────────  Changes: version 16-20

5. Apply changes
   INSERT INTO crsql_changes     → Automatic merge

6. Push local changes to Node B
   SELECT * FROM crsql_changes
   WHERE db_version > last_sync  → Changes: version 21-25
                                 ────────────────────────►

                                 7. Apply changes
                                    INSERT INTO crsql_changes
                                    → Automatic merge

Result: Both nodes at version 25, all changes merged
```

### Advantages of cr-sqlite

| Feature | Benefit |
|---------|---------|
| **True multi-master** | All nodes can read and write simultaneously |
| **Automatic conflict resolution** | No manual timestamp comparison needed |
| **Column-level tracking** | More granular than row-level |
| **Mathematically correct** | CRDT guarantees eventual consistency |
| **Offline support** | Changes queue locally, sync when online |
| **No central server** | True P2P architecture |
| **Order independent** | Changes can arrive in any order |

### Disadvantages and Limitations

| Issue | Impact |
|-------|--------|
| **Requires CGo** | Complex build, platform dependencies |
| **Extension installation** | Need to compile and load cr-sqlite extension |
| **Storage overhead** | Metadata for version vectors (~30% overhead) |
| **Learning curve** | CRDT concepts are complex |
| **Maturity** | Relatively new project (2021) |
| **Limited ecosystem** | Fewer tools and examples |
| **Schema migrations** | More complex with CRDT tables |
| **No standard** | Proprietary to vlcn.io |

### Performance Comparison

```
Scenario: Sync 1000 word records between 3 nodes

Timestamp-based (current):
- Transfer size: ~200KB (full records)
- Conflicts: Manual comparison of 1000 timestamps
- Time: ~500ms
- Storage: No overhead

cr-sqlite:
- Transfer size: ~80KB (only changes with metadata)
- Conflicts: Automatic CRDT merge
- Time: ~200ms (faster merge)
- Storage: +30% (version vectors)
```

### Use Case Fit Analysis

#### ✅ Great for cr-sqlite (NOT your case):

1. **High-frequency concurrent writes**
   ```
   Example: Collaborative document editing
   - 10 users typing simultaneously
   - Character-level CRDTs
   - Real-time sync

   Your case: Single user at a time ❌
   ```

2. **Complex conflict scenarios**
   ```
   Example: Distributed inventory system
   - Multiple warehouses updating stock
   - Need to preserve all updates
   - Complex merge logic

   Your case: Simple timestamp comparison works ❌
   ```

3. **Offline-first apps with unpredictable network**
   ```
   Example: Mobile field service app
   - Technicians work offline all day
   - Sync when back to office
   - Many concurrent offline users

   Your case: Only you, predictable schedule ❌
   ```

#### ❌ Overkill for your project:

**Your requirements**:
- 3 nodes (Desktop, MacBook, Ubuntu)
- **Single user at a time** (no concurrent writes)
- Simple schema (words, user_dicts, users)
- Low change frequency (~10 words/day)
- Simple conflict rule: "keep newer"

**Why cr-sqlite is overkill**:

1. **No concurrent writes**: You never write to 2 nodes simultaneously
   - CRDT's main benefit is handling concurrent conflicts
   - You don't have concurrent conflicts (only sequential)

2. **Simple conflict resolution**: Timestamp comparison is sufficient
   ```
   Current: if remote.update_datetime > local.update_datetime → keep remote
   cr-sqlite: Complex version vector comparison → same result
   ```

3. **Storage overhead**: +30% for metadata you don't need
   ```
   Current: 1000 words = ~500KB
   cr-sqlite: 1000 words = ~650KB (150KB wasted on version vectors)
   ```

4. **Complexity**: CGo + CRDT concepts vs simple SQL
   ```
   Current: SELECT * FROM words WHERE update_datetime > ?
   cr-sqlite: Understand version vectors, site IDs, column versions
   ```

### Comparison Table

| Aspect | Timestamp (Current) | cr-sqlite |
|--------|---------------------|-----------|
| **Concurrent writes** | ❌ Last write wins | ✅ CRDT merge |
| **Your use case** | ✅ Sequential writes | ❌ Overkill |
| **Complexity** | ⭐⭐ Simple | ⭐⭐⭐⭐⭐ Complex |
| **Build** | ✅ Pure Go | ❌ CGo required |
| **Storage** | ✅ No overhead | ❌ +30% overhead |
| **Maturity** | ✅ Battle-tested | ⚠️ New (2021) |
| **Debugging** | ✅ SQL + timestamps | ⚠️ Version vectors |
| **Restart-safe** | ✅ Persistent | ✅ Persistent |
| **Offline-safe** | ✅ Works | ✅ Works |

### Installation Requirements

If you still want to try cr-sqlite:

```bash
# 1. Clone and build cr-sqlite
git clone https://github.com/vlcn-io/cr-sqlite
cd cr-sqlite
make loadable

# 2. Copy extension to system
cp crsqlite.so /usr/local/lib/

# 3. Load in Go
import _ "github.com/mattn/go-sqlite3"

db, err := sql.Open("sqlite3", "enx.db?_extensions=/usr/local/lib/crsqlite")

# 4. Enable for tables
db.Exec("SELECT crsql_as_crr('words')")
```

### Real-World Example: When cr-sqlite Shines

**Notion-like collaborative app**:
```
Scenario: 5 users editing same document
─────────────────────────────────────────
User A: Types "Hello" at 10:00:00.000
User B: Types "World" at 10:00:00.001
User C: Deletes char at 10:00:00.002
User D: Formats text at 10:00:00.003
User E: Inserts image at 10:00:00.004

All happening simultaneously, offline/online

cr-sqlite: ✅ Handles perfectly with CRDTs
Timestamp: ❌ Would lose some edits
```

**Your scenario: ENX vocabulary learning**:
```
Monday:    Desktop adds "hello"     (you)
Tuesday:   Desktop adds "world"     (you)
Wednesday: MacBook adds "goodbye"   (you, while traveling)

Only ONE writer at a time

cr-sqlite: Overkill (CRDT for single user?)
Timestamp: ✅ Perfect fit
```

### Recommendation

**Do NOT use cr-sqlite for your project** because:

1. ❌ **No concurrent writes**: Single user, sequential access
2. ❌ **Simple conflicts**: Timestamp comparison is sufficient
3. ❌ **CGo complexity**: Build issues, platform dependencies
4. ❌ **Storage waste**: 30% overhead for unused metadata
5. ❌ **Learning curve**: CRDT concepts add no value
6. ❌ **Maturity risk**: Newer project, fewer users
7. ✅ **Current solution works**: Timestamp-based is simpler and sufficient

**When to reconsider**:
- If you add real-time collaboration (multiple users editing simultaneously)
- If you need character-level merging (like Google Docs)
- If conflict resolution becomes complex (not just "keep newer")

For your use case (single-user, offline-capable, simple sync), **timestamp-based approach is ideal**.

### If You Still Want to Try

Here's a minimal example repo structure:

```
enx-data-service/
├── go.mod
├── session/
│   ├── manager.go         # CGo wrapper for Session API
│   ├── manager.h          # C headers
│   └── manager_test.go
├── storage/
│   └── changeset_store.go # Persistent changeset storage
└── sync/
    └── session_sync.go    # Sync using Session Extension
```

Let me know if you want me to create a proof-of-concept implementation!

## Deployment Configuration

### Single Node (Development)

```yaml
# docker-compose.yml
version: '3.8'

services:
  data-service:
    image: enx-data-service:latest
    ports:
      - "8091:8091"
    volumes:
      - ./data:/data
    environment:
      - PORT=8091
      - DB_PATH=/data/enx.db
      - LOG_LEVEL=debug

  api:
    image: enx-api:latest
    ports:
      - "8090:8090"
    environment:
      - DATA_SERVICE_URL=data-service:8091
    depends_on:
      - data-service
```

### Multi-Node (Production)

```yaml
# Host A
services:
  data-service-a:
    image: enx-data-service:latest
    ports:
      - "8091:8091"
    environment:
      - NODE_ID=host-a
      - PEERS=host-b:8091,host-c:8091
      - SYNC_INTERVAL=300  # 5 minutes

# Host B
services:
  data-service-b:
    image: enx-data-service:latest
    ports:
      - "8091:8091"
    environment:
      - NODE_ID=host-b
      - PEERS=host-a:8091,host-c:8091
      - SYNC_INTERVAL=300

# Host C
services:
  data-service-c:
    image: enx-data-service:latest
    ports:
      - "8091:8091"
    environment:
      - NODE_ID=host-c
      - PEERS=host-a:8091,host-b:8091
      - SYNC_INTERVAL=300
```

## Implementation Timeline

### Phase 1: Foundation (Week 1-2)

- [ ] Create enx-data-service project structure
- [ ] Define Protocol Buffers / REST API
- [ ] Implement basic CRUD operations
- [ ] Create client library for enx-api
- [ ] Update enx-api to use data client
- [ ] Single-node testing

### Phase 2: Sync Implementation (Week 3-4)

- [ ] Implement change tracking
- [ ] Implement GetChanges API
- [ ] Implement PushChanges API
- [ ] Node discovery and registration
- [ ] P2P sync logic
- [ ] Conflict resolution
- [ ] Multi-node testing

### Phase 3: Optimization (Week 5-6)

- [ ] Add caching layer
- [ ] Implement connection pooling
- [ ] Add retry mechanisms
- [ ] Performance testing
- [ ] Load testing
- [ ] Optimization

### Phase 4: Production Readiness (Week 7-8)

- [ ] Add authentication
- [ ] Enable TLS
- [ ] Monitoring and metrics
- [ ] Logging and tracing
- [ ] Documentation
- [ ] Deployment automation
- [ ] Production deployment

## Future Enhancements

### Short-term (3-6 months)

- [ ] Web UI for monitoring sync status
- [ ] Conflict resolution UI
- [ ] Data backup and restore
- [ ] Metrics dashboard

### Medium-term (6-12 months)

- [ ] Support for PostgreSQL backend
- [ ] Redis caching layer
- [ ] Multi-tenancy support
- [ ] Advanced analytics

### Long-term (12+ months)

- [ ] Global distribution with geo-replication
- [ ] Event sourcing architecture
- [ ] Machine learning for conflict resolution
- [ ] Mobile client support

## Generalization: SQLite Sync as Open Source Project

### 💡 Vision: Universal SQLite P2P Sync Tool

**The insight**: This data service design is actually **business-agnostic** and could be extracted into a standalone open-source project: **`sqlite-p2p-sync`**

### Core Concept

A **generic SQLite synchronization service** that can sync any SQLite database across multiple nodes using timestamp-based conflict resolution.

### Key Features of Generic Tool

#### 1. **Configuration-Driven** (No Code Changes)

```yaml
# sync-config.yaml
database:
  path: "./my-app.db"

tables:
  - name: "users"
    timestamp_column: "updated_at"
    primary_key: "id"

  - name: "posts"
    timestamp_column: "modified_time"
    primary_key: "post_id"

  - name: "comments"
    timestamp_column: "update_datetime"
    primary_key: ["post_id", "comment_id"]  # Composite key

sync:
  interval: "5m"
  conflict_resolution: "latest_wins"  # or: manual, custom

nodes:
  - name: "desktop"
    address: "192.168.1.100:8091"
  - name: "laptop"
    address: "192.168.1.101:8091"
```

#### 2. **Generic Query API Design** 🔍

For a universal data service, the query API must be flexible enough to handle any table schema without hardcoding specific fields.

**✅ Design Decision Summary:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHOSEN APPROACH: Hybrid (Option C)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Why Hybrid?
• Structured APIs (Find/Insert/Update/Delete) for 80% of use cases
  → Type-safe, secure, easy to use
  → Automatic query building from JSON filters

• Raw SQL (Query/Execute) for remaining 20% complex cases
  → JOINs, aggregations, subqueries, CTEs
  → Full SQL power when needed

• Best of both worlds:
  ✅ Security: Structured APIs prevent most SQL injection
  ✅ Flexibility: Raw SQL handles edge cases
  ✅ Performance: Both approaches equally fast
  ✅ Developer experience: Easy for simple, powerful for complex

Implementation:
  1. Start with structured APIs (safer)
  2. Fall back to raw SQL only when necessary
  3. Both share same security validation layer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Design Approaches:**

##### **Option A: SQL Passthrough (Simplest)** ⭐⭐⭐

Direct SQL query execution with parameter binding:

```protobuf
service GenericDataService {
  // Execute arbitrary SQL query
  rpc Query(QueryRequest) returns (QueryResponse);

  // Execute write operations (INSERT/UPDATE/DELETE)
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);
}

message QueryRequest {
  string sql = 1;                    // SQL query
  repeated QueryParam params = 2;    // Bound parameters
  int32 limit = 3;                   // Optional row limit
  int32 offset = 4;                  // Optional offset for pagination
}

message QueryParam {
  oneof value {
    string string_value = 1;
    int64 int_value = 2;
    double double_value = 3;
    bool bool_value = 4;
    bytes bytes_value = 5;
  }
}

message QueryResponse {
  repeated string columns = 1;       // Column names
  repeated Row rows = 2;             // Result rows
  int32 rows_affected = 3;           // For write operations
}

message Row {
  repeated Cell cells = 1;           // Row values
}

message Cell {
  oneof value {
    string string_value = 1;
    int64 int_value = 2;
    double double_value = 3;
    bool bool_value = 4;
    bytes bytes_value = 5;
    bool is_null = 6;                // NULL value indicator
  }
}
```

**Usage Example:**

```go
// Query with parameters
resp, err := client.Query(ctx, &pb.QueryRequest{
    Sql: "SELECT * FROM users WHERE age > ? AND city = ?",
    Params: []*pb.QueryParam{
        {Value: &pb.QueryParam_IntValue{IntValue: 18}},
        {Value: &pb.QueryParam_StringValue{StringValue: "Beijing"}},
    },
    Limit: 100,
})

// Insert with parameters
resp, err := client.Execute(ctx, &pb.ExecuteRequest{
    Sql: "INSERT INTO users (name, age, email) VALUES (?, ?, ?)",
    Params: []*pb.QueryParam{
        {Value: &pb.QueryParam_StringValue{StringValue: "Alice"}},
        {Value: &pb.QueryParam_IntValue{IntValue: 25}},
        {Value: &pb.QueryParam_StringValue{StringValue: "alice@example.com"}},
    },
})
```

**Pros:**
- ✅ Maximum flexibility - supports any SQL query
- ✅ No need to define schema in protobuf
- ✅ Works with any table structure
- ✅ Simple implementation

**Cons:**
- ⚠️ SQL injection risk (mitigated by parameterized queries)
- ⚠️ No type safety at compile time
- ⚠️ Client needs to know SQL syntax

##### **Option B: JSON-Based Query Builder** ⭐⭐⭐⭐

Structured query using JSON-like filters (similar to MongoDB):

```protobuf
service GenericDataService {
  rpc Find(FindRequest) returns (FindResponse);
  rpc Insert(InsertRequest) returns (InsertResponse);
  rpc Update(UpdateRequest) returns (UpdateResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
}

message FindRequest {
  string table = 1;                  // Table name
  string filter = 2;                 // JSON filter: {"age": {"$gt": 18}}
  string projection = 3;             // JSON fields: {"name": 1, "email": 1}
  string sort = 4;                   // JSON sort: {"age": -1}
  int32 limit = 5;
  int32 offset = 6;
}

message InsertRequest {
  string table = 1;
  repeated string records = 2;       // JSON records
}

message UpdateRequest {
  string table = 1;
  string filter = 2;                 // JSON filter
  string update = 3;                 // JSON update: {"$set": {"age": 26}}
}

message DeleteRequest {
  string table = 1;
  string filter = 2;                 // JSON filter
}
```

**Usage Example:**

```go
// Find with filter
resp, err := client.Find(ctx, &pb.FindRequest{
    Table: "users",
    Filter: `{"age": {"$gt": 18}, "city": "Beijing"}`,
    Projection: `{"name": 1, "email": 1}`,  // Only return name and email
    Sort: `{"age": -1}`,                    // Sort by age descending
    Limit: 100,
})

// Update with filter
resp, err := client.Update(ctx, &pb.UpdateRequest{
    Table: "users",
    Filter: `{"email": "alice@example.com"}`,
    Update: `{"$set": {"age": 26, "city": "Shanghai"}}`,
})
```

**Pros:**
- ✅ More structured than raw SQL
- ✅ Familiar to NoSQL users
- ✅ Type-safe operators ($gt, $lt, $in, etc.)
- ✅ No SQL injection risk

**Cons:**
- ⚠️ Need to implement query parser
- ⚠️ Limited to supported operators
- ⚠️ Still uses JSON strings (no compile-time checking)

##### **Option C: Hybrid Approach** (✅ **CHOSEN**) ⭐⭐⭐⭐⭐

**Decision: This is the selected approach for the generic SQLite sync service**

Combine both approaches for maximum flexibility:

```protobuf
service GenericDataService {
  // Simple CRUD (type-safe, recommended for common operations)
  rpc Find(FindRequest) returns (FindResponse);
  rpc Insert(InsertRequest) returns (InsertResponse);
  rpc Update(UpdateRequest) returns (UpdateResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);

  // Raw SQL (flexible, for complex queries)
  rpc Query(QueryRequest) returns (QueryResponse);
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);

  // Batch operations
  rpc BatchExecute(stream BatchRequest) returns (BatchResponse);
}
```

**When to use each:**

```
Common CRUD operations:
  → Use Find/Insert/Update/Delete (structured, safer)

Complex queries (JOINs, aggregations, subqueries):
  → Use Query/Execute (raw SQL, more powerful)

Bulk operations:
  → Use BatchExecute (efficient)

Example decision tree:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Query type                           → API to use
─────────────────────────────────────────────────────────
SELECT * FROM users WHERE age > 18   → Find()
INSERT INTO users VALUES (...)       → Insert()
UPDATE users SET age = 26 WHERE ...  → Update()
DELETE FROM users WHERE ...          → Delete()

SELECT u.*, p.title FROM users u
  JOIN posts p ON u.id = p.user_id   → Query() (complex JOIN)

SELECT COUNT(*), AVG(age)
  FROM users GROUP BY city           → Query() (aggregation)

WITH RECURSIVE ... (CTE query)       → Query() (advanced SQL)
```

**Complete Implementation Example:**

```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"

    _ "github.com/mattn/go-sqlite3"
)

// ==================== Server Implementation ====================

type GenericDataService struct {
    db *sql.DB
}

// Find - Structured query (JSON filter)
func (s *GenericDataService) Find(ctx context.Context, req *pb.FindRequest) (*pb.FindResponse, error) {
    // Parse JSON filter
    var filter map[string]interface{}
    if err := json.Unmarshal([]byte(req.Filter), &filter); err != nil {
        return nil, fmt.Errorf("invalid filter: %w", err)
    }

    // Build SQL query
    query, args := buildSelectQuery(req.Table, filter, req.Projection, req.Sort, req.Limit, req.Offset)

    // Execute query
    rows, err := s.db.QueryContext(ctx, query, args...)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    // Convert rows to response
    return rowsToResponse(rows)
}

// Query - Raw SQL execution
func (s *GenericDataService) Query(ctx context.Context, req *pb.QueryRequest) (*pb.QueryResponse, error) {
    // Validate SQL (prevent destructive operations)
    if err := validateSQL(req.Sql); err != nil {
        return nil, err
    }

    // Convert protobuf params to []interface{}
    args := make([]interface{}, len(req.Params))
    for i, param := range req.Params {
        args[i] = extractParamValue(param)
    }

    // Execute query
    rows, err := s.db.QueryContext(ctx, req.Sql, args...)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    return rowsToResponse(rows)
}

// Helper: Build SELECT query from JSON filter
func buildSelectQuery(table string, filter map[string]interface{},
                      projection, sort string, limit, offset int32) (string, []interface{}) {

    query := fmt.Sprintf("SELECT * FROM %s", sanitizeIdentifier(table))
    args := []interface{}{}

    // Add WHERE clause
    if len(filter) > 0 {
        where, whereArgs := buildWhereClause(filter)
        query += " WHERE " + where
        args = append(args, whereArgs...)
    }

    // Add ORDER BY
    if sort != "" {
        var sortMap map[string]int
        json.Unmarshal([]byte(sort), &sortMap)
        query += buildOrderBy(sortMap)
    }

    // Add LIMIT/OFFSET
    if limit > 0 {
        query += fmt.Sprintf(" LIMIT %d", limit)
        if offset > 0 {
            query += fmt.Sprintf(" OFFSET %d", offset)
        }
    }

    return query, args
}

// Helper: Build WHERE clause from filter
func buildWhereClause(filter map[string]interface{}) (string, []interface{}) {
    var conditions []string
    var args []interface{}

    for field, value := range filter {
        switch v := value.(type) {
        case map[string]interface{}:
            // Operators: {"age": {"$gt": 18}}
            for op, val := range v {
                switch op {
                case "$gt":
                    conditions = append(conditions, fmt.Sprintf("%s > ?", sanitizeIdentifier(field)))
                    args = append(args, val)
                case "$gte":
                    conditions = append(conditions, fmt.Sprintf("%s >= ?", sanitizeIdentifier(field)))
                    args = append(args, val)
                case "$lt":
                    conditions = append(conditions, fmt.Sprintf("%s < ?", sanitizeIdentifier(field)))
                    args = append(args, val)
                case "$lte":
                    conditions = append(conditions, fmt.Sprintf("%s <= ?", sanitizeIdentifier(field)))
                    args = append(args, val)
                case "$ne":
                    conditions = append(conditions, fmt.Sprintf("%s != ?", sanitizeIdentifier(field)))
                    args = append(args, val)
                case "$in":
                    // Handle IN operator with multiple values
                    if arr, ok := val.([]interface{}); ok {
                        placeholders := strings.Repeat("?,", len(arr))
                        placeholders = placeholders[:len(placeholders)-1]
                        conditions = append(conditions, fmt.Sprintf("%s IN (%s)", sanitizeIdentifier(field), placeholders))
                        args = append(args, arr...)
                    }
                }
            }
        default:
            // Simple equality: {"city": "Beijing"}
            conditions = append(conditions, fmt.Sprintf("%s = ?", sanitizeIdentifier(field)))
            args = append(args, value)
        }
    }

    return strings.Join(conditions, " AND "), args
}

// Helper: Sanitize SQL identifiers (prevent injection)
func sanitizeIdentifier(name string) string {
    // Only allow alphanumeric and underscore
    reg := regexp.MustCompile(`^[a-zA-Z0-9_]+$`)
    if !reg.MatchString(name) {
        panic(fmt.Sprintf("invalid identifier: %s", name))
    }
    return name
}

// Helper: Validate SQL (prevent dangerous operations)
func validateSQL(sql string) error {
    sql = strings.ToUpper(strings.TrimSpace(sql))

    // Allow only SELECT, INSERT, UPDATE, DELETE
    allowedPrefixes := []string{"SELECT", "INSERT", "UPDATE", "DELETE"}
    allowed := false
    for _, prefix := range allowedPrefixes {
        if strings.HasPrefix(sql, prefix) {
            allowed = true
            break
        }
    }

    if !allowed {
        return fmt.Errorf("SQL statement not allowed: must start with SELECT/INSERT/UPDATE/DELETE")
    }

    // Block dangerous keywords
    dangerousKeywords := []string{"DROP", "TRUNCATE", "ALTER", "CREATE", "PRAGMA"}
    for _, keyword := range dangerousKeywords {
        if strings.Contains(sql, keyword) {
            return fmt.Errorf("SQL contains forbidden keyword: %s", keyword)
        }
    }

    return nil
}

// ==================== Client Usage ====================

func ExampleClientUsage() {
    conn, _ := grpc.Dial("localhost:8091", grpc.WithInsecure())
    client := pb.NewGenericDataServiceClient(conn)

    // Example 1: Simple structured query
    resp, err := client.Find(context.Background(), &pb.FindRequest{
        Table: "users",
        Filter: `{"age": {"$gt": 18}, "city": "Beijing"}`,
        Limit: 100,
    })

    // Example 2: Complex JOIN with raw SQL
    resp, err = client.Query(context.Background(), &pb.QueryRequest{
        Sql: `
            SELECT u.name, u.email, COUNT(p.id) as post_count
            FROM users u
            LEFT JOIN posts p ON u.id = p.user_id
            WHERE u.age > ?
            GROUP BY u.id
            HAVING post_count > ?
            ORDER BY post_count DESC
            LIMIT ?
        `,
        Params: []*pb.QueryParam{
            {Value: &pb.QueryParam_IntValue{IntValue: 18}},
            {Value: &pb.QueryParam_IntValue{IntValue: 5}},
            {Value: &pb.QueryParam_IntValue{IntValue: 10}},
        },
    })

    // Example 3: Insert with structured API
    resp, err = client.Insert(context.Background(), &pb.InsertRequest{
        Table: "users",
        Records: []string{
            `{"name": "Alice", "age": 25, "email": "alice@example.com"}`,
            `{"name": "Bob", "age": 30, "email": "bob@example.com"}`,
        },
    })
}
```

**Security Considerations for Generic Query API:**

```go
// ==================== Security Best Practices ====================

// 1. Input Validation
func validateTableName(table string) error {
    // Only allow configured tables
    allowedTables := config.GetAllowedTables()
    if !contains(allowedTables, table) {
        return fmt.Errorf("table not allowed: %s", table)
    }
    return nil
}

// 2. Query Complexity Limits
func validateQueryComplexity(sql string) error {
    // Limit number of JOINs
    joinCount := strings.Count(strings.ToUpper(sql), "JOIN")
    if joinCount > 5 {
        return fmt.Errorf("too many JOINs: %d (max: 5)", joinCount)
    }

    // Limit subquery depth
    subqueryDepth := strings.Count(sql, "(SELECT")
    if subqueryDepth > 3 {
        return fmt.Errorf("subquery too deep: %d (max: 3)", subqueryDepth)
    }

    return nil
}

// 3. Rate Limiting per Client
type QueryRateLimiter struct {
    limiters map[string]*rate.Limiter
    mu       sync.RWMutex
}

func (r *QueryRateLimiter) Allow(clientID string) bool {
    r.mu.RLock()
    limiter, exists := r.limiters[clientID]
    r.mu.RUnlock()

    if !exists {
        r.mu.Lock()
        limiter = rate.NewLimiter(rate.Limit(100), 10) // 100 req/sec, burst 10
        r.limiters[clientID] = limiter
        r.mu.Unlock()
    }

    return limiter.Allow()
}

// 4. Query Timeout
func executeWithTimeout(ctx context.Context, db *sql.DB, query string, args ...interface{}) (*sql.Rows, error) {
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    return db.QueryContext(ctx, query, args...)
}

// 5. Row Limit Enforcement
const MaxRowsPerQuery = 10000

func enforceRowLimit(req *pb.QueryRequest) {
    if req.Limit == 0 || req.Limit > MaxRowsPerQuery {
        req.Limit = MaxRowsPerQuery
    }
}
```

**Configuration for Security:**

```yaml
# sync-config.yaml
security:
  # Allow only specific tables
  allowed_tables:
    - "users"
    - "posts"
    - "comments"

  # Query limits
  max_query_complexity: 5        # Max JOINs
  max_subquery_depth: 3
  max_rows_per_query: 10000
  query_timeout_seconds: 30

  # Rate limiting
  rate_limit_per_client: 100     # Requests per second
  rate_limit_burst: 10

  # SQL restrictions
  allow_raw_sql: true            # Enable/disable Query() API
  forbidden_keywords:
    - "DROP"
    - "TRUNCATE"
    - "ALTER"
    - "CREATE"
    - "PRAGMA"
    - "ATTACH"
    - "DETACH"
```

#### 3. **Automatic Metadata Table**

The tool automatically creates a sync tracking table:

```sql
-- Auto-created by sqlite-p2p-sync
CREATE TABLE IF NOT EXISTS _sync_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    node_id TEXT NOT NULL,
    last_sync_time TEXT NOT NULL,  -- RFC3339 timestamp
    last_sync_checksum TEXT,       -- Optional: verify integrity
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(table_name, node_id)
);

-- Track sync status per table per node
-- Example rows:
-- table_name | node_id  | last_sync_time           | last_sync_checksum
-- -----------|----------|--------------------------|-------------------
-- users      | desktop  | 2025-11-12T10:00:00Z    | abc123def456
-- users      | laptop   | 2025-11-12T09:55:00Z    | abc123def456
-- posts      | desktop  | 2025-11-12T10:05:00Z    | 789ghi012jkl
```

#### 3. **Flexible Timestamp Detection**

```yaml
# Supports multiple timestamp column naming conventions
timestamp_column_patterns:
  - "updated_at"
  - "modified_at"
  - "update_time"
  - "update_datetime"
  - "last_modified"

# Or custom per table
tables:
  - name: "legacy_table"
    timestamp_column: "LAST_UPD_TS"  # Custom column name
```

#### 4. **Conflict Resolution Strategies**

```go
type ConflictResolver interface {
    Resolve(local, remote Record) (Record, error)
}

// Built-in strategies
strategies := map[string]ConflictResolver{
    "latest_wins":     &LatestWinsResolver{},      // Use newer timestamp
    "source_wins":     &SourceWinsResolver{},      // Prefer specific node
    "manual":          &ManualResolver{},          // Require user input
    "custom_function": &CustomFunctionResolver{},  // User-defined logic
}
```

### Architecture of Generic Tool

```
┌─────────────────────────────────────────────────────────────────┐
│                    sqlite-p2p-sync (Generic Tool)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────┐      ┌────────────────┐                   │
│  │ Config Loader  │      │  Sync Engine   │                   │
│  │ - Read YAML    │─────▶│ - Timestamp    │                   │
│  │ - Validate     │      │ - Conflict Res │                   │
│  └────────────────┘      └────────────────┘                   │
│                                   │                             │
│  ┌────────────────┐      ┌────────────────┐                   │
│  │ Metadata Mgmt  │◀─────│  gRPC Server   │                   │
│  │ - Track sync   │      │ - Serve data   │                   │
│  │ - Checksum     │      │ - P2P sync     │                   │
│  └────────────────┘      └────────────────┘                   │
│          │                        │                             │
│          ▼                        ▼                             │
│  ┌──────────────────────────────────────┐                     │
│  │        SQLite Database                │                     │
│  │  - User tables (any schema)           │                     │
│  │  - _sync_metadata (auto-created)      │                     │
│  └──────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Usage Example

#### Installation
```bash
# Install as standalone tool
go install github.com/yourname/sqlite-p2p-sync@latest

# Or use Docker
docker pull yourname/sqlite-p2p-sync:latest
```

#### Configuration
```bash
# Initialize sync for existing database
sqlite-p2p-sync init --db ./myapp.db --auto-detect

# Output: Generated sync-config.yaml with detected tables:
# ✅ Found table 'users' with timestamp column 'updated_at'
# ✅ Found table 'posts' with timestamp column 'modified_time'
# ⚠️  Table 'logs' has no timestamp column, skipped
```

#### Running
```bash
# Start sync service
sqlite-p2p-sync start --config sync-config.yaml

# Output:
# 🚀 SQLite P2P Sync v1.0.0
# 📁 Database: ./myapp.db
# 📊 Syncing tables: users, posts, comments
# 🔄 Sync interval: 5 minutes
# 🌐 Listening on :8091
# ✅ Ready for sync
```

#### Integration with Existing App

```go
// Your existing application (enx-api)
package main

import (
    "database/sql"
    syncpb "github.com/yourname/sqlite-p2p-sync/proto"
    "google.golang.org/grpc"
)

func main() {
    // Option 1: Direct database access (local only)
    db, _ := sql.Open("sqlite3", "./enx.db")

    // Option 2: Use sync service (for sync-enabled access)
    conn, _ := grpc.Dial("localhost:8091", grpc.WithInsecure())
    syncClient := syncpb.NewSyncServiceClient(conn)

    // Your app code remains unchanged!
    // Sync happens in background automatically
}
```

### Optimization Suggestions

#### 1. **Smart Sync: Only Changed Records**

Instead of scanning all records every time:

```sql
-- Current approach (full scan)
SELECT * FROM users WHERE updated_at > ?

-- Optimized: Use change tracking table
CREATE TABLE _sync_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,  -- INSERT, UPDATE, DELETE
    timestamp TEXT NOT NULL,
    synced INTEGER DEFAULT 0,
    UNIQUE(table_name, record_id, timestamp)
);

-- Populate with triggers
CREATE TRIGGER track_user_changes
AFTER INSERT OR UPDATE OR DELETE ON users
BEGIN
    INSERT INTO _sync_changes (table_name, record_id, operation, timestamp)
    VALUES ('users', NEW.id, 'UPDATE', NEW.updated_at);
END;
```

**Benefit**: Only sync changed records, not full table scan every time.

#### 2. **Batch Sync with Checksum**

```go
// Send batch with checksum for integrity verification
type SyncBatch struct {
    TableName string
    Records   []Record
    Checksum  string  // SHA256 of all records
    TimeRange TimeRange
}

// Receiver verifies checksum
func (s *SyncService) ReceiveBatch(batch SyncBatch) error {
    calculatedChecksum := sha256(batch.Records)
    if calculatedChecksum != batch.Checksum {
        return ErrChecksumMismatch  // Request re-sync
    }
    // Apply changes...
}
```

#### 3. **Delta Sync (Advanced)**

For large tables, send only diffs:

```go
type RecordDelta struct {
    RecordID   string
    ChangedFields map[string]interface{}  // Only changed columns
    Timestamp  time.Time
}

// Example: User changed email only
// Before: {id: 1, name: "Alice", email: "old@example.com", updated_at: "10:00"}
// After:  {id: 1, name: "Alice", email: "new@example.com", updated_at: "10:05"}
// Delta:  {id: 1, changes: {email: "new@example.com"}, timestamp: "10:05"}
```

#### 4. **Compression for Large Datasets**

```go
// Compress sync payload
func (s *SyncService) GetChanges(req *SyncRequest) (*SyncResponse, error) {
    changes := s.fetchChanges(req.Since)

    // Compress if large
    if len(changes) > 1000 {
        compressed := gzip.Compress(changes)
        return &SyncResponse{
            Data:       compressed,
            Compressed: true,
        }
    }

    return &SyncResponse{Data: changes}
}
```

#### 5. **Schema Version Tracking**

```sql
CREATE TABLE _sync_schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT
);

-- Prevent sync between incompatible schema versions
-- Node A: schema v1.2.0
-- Node B: schema v1.1.0
-- → Sync blocked until Node B upgrades
```

### Comparison: ENX-Specific vs Generic Tool

| Feature | ENX-Specific | Generic Tool |
|---------|--------------|--------------|
| **Coupling** | Tightly coupled to ENX schema | Schema-agnostic |
| **Configuration** | Hardcoded tables | YAML config |
| **Reusability** | ENX only | Any SQLite app |
| **Maintenance** | Custom code | Community-driven |
| **Learning Curve** | ENX domain knowledge | SQLite + config |
| **Flexibility** | ENX-optimized | Universal |

### Recommended Approach

**✅ Build Generic Tool First, Then Use in ENX**

```
Phase 1: Build sqlite-p2p-sync (Generic) - 4-6 weeks
├── Week 1-2: Core Components
│   ├── Config parser (YAML → Table metadata)
│   ├── SQLite WAL integration
│   ├── Metadata table auto-creation
│   └── Basic CRUD operations
│
├── Week 3-4: Query API (Hybrid Approach) ✅ CHOSEN
│   ├── Structured APIs: Find/Insert/Update/Delete
│   │   └── JSON filter parser
│   │   └── WHERE clause builder
│   │   └── Operator support ($gt, $lt, $in, etc.)
│   ├── Raw SQL APIs: Query/Execute
│   │   └── SQL validation
│   │   └── Parameterized queries
│   │   └── Query complexity limits
│   └── Security layer
│       └── Table whitelist
│       └── SQL keyword blocking
│       └── Rate limiting
│
└── Week 5-6: Sync Engine
    ├── P2P node discovery
    ├── Timestamp-based conflict resolution
    ├── Change tracking (trigger-based)
    └── gRPC streaming for sync

Phase 2: Use in ENX - 1-2 weeks
├── Create enx-sync-config.yaml
│   └── Configure words, user_dicts, users tables
│   └── Set timestamp columns
│   └── Define conflict resolution rules
├── Start sqlite-p2p-sync service
│   └── Port 8091 (data service)
│   └── Auto-detect existing enx.db
└── Integrate enx-api
    └── Replace direct SQLite calls with gRPC
    └── Use Find() for simple queries
    └── Use Query() for complex JOINs

Phase 3: Testing & Validation - 1 week
├── Unit tests (90% coverage target)
├── Integration tests (E2E sync scenarios)
├── Performance benchmarks
│   └── Simple queries: < 10ms
│   └── Complex queries: < 100ms
│   └── Sync operations: < 1s for 1000 records
└── Security audit
    └── SQL injection tests
    └── Rate limit validation
    └── Access control verification

Phase 4: Open Source - 2-3 weeks
├── Documentation
│   └── README with quick start
│   └── API reference (all endpoints)
│   └── Configuration guide
│   └── Migration examples
├── Example projects
│   └── Simple note-taking app
│   └── Todo list with sync
│   └── Blog with multi-device editing
├── Publish to GitHub
│   └── Apache 2.0 license
│   └── CI/CD setup (GitHub Actions)
│   └── Docker images
└── Community building
    └── Blog post announcement
    └── Reddit/HackerNews post
    └── Documentation website
```

**Total Timeline: 8-12 weeks from start to open source release**

### Benefits of Generic Approach

1. **✅ Broader Impact**: Help other SQLite users with same problem
2. **✅ Better Design**: Forced to think generically = cleaner architecture
3. **✅ Community Support**: Others contribute features/bug fixes
4. **✅ Portfolio Project**: Demonstrates architectural thinking
5. **✅ Dogfooding**: ENX becomes first real-world user
6. **✅ Learning**: Forces you to handle edge cases from different use cases

### Potential Project Name Ideas

- `sqlite-p2p-sync` - Clear and descriptive
- `sqlitesync` - Simple and memorable
- `litesync` - Short and catchy
- `dbsync` - Generic but might conflict
- `syncql` - Creative but less clear

### Next Steps

1. **Validate Design**: Review current ENX sync design
2. **Extract Generic Parts**: Identify business-agnostic components
3. **Define Config Schema**: Design YAML configuration format
4. **Build MVP**: Basic sync with single table
5. **Test with ENX**: Use ENX as first real user
6. **Open Source**: Publish when stable

## Conclusion

This architecture provides:

1. **Clear separation of concerns**: Business logic vs data management
2. **Flexible communication**: gRPC for performance, REST for debugging
3. **P2P synchronization**: No single point of failure
4. **Offline support**: Continue working, sync when online
5. **Scalability**: Easy to add nodes or upgrade storage
6. **Maintainability**: Well-defined interfaces and protocols

### Key Design Decisions ✅

**Protocol Layer:**
- ✅ **Hybrid Approach** (gRPC + REST) gives us the best of both worlds: performance where it matters and ease of use for development and debugging

**Query API:**
- ✅ **Hybrid Query API** (Structured + Raw SQL)
  - **80% use cases**: Structured APIs (Find/Insert/Update/Delete) for type safety and security
  - **20% edge cases**: Raw SQL (Query/Execute) for complex operations (JOINs, aggregations)
  - **Security**: Multi-layer validation, rate limiting, query complexity limits
  - **Performance**: Both approaches equally fast, optimized for different scenarios

**Why Hybrid Wins:**
```
Structured APIs (Find/Insert/Update/Delete):
  ✅ Type-safe JSON filters
  ✅ Automatic SQL generation
  ✅ Built-in security (no SQL injection)
  ✅ Easy to use for common cases

Raw SQL APIs (Query/Execute):
  ✅ Full SQL power (JOINs, CTEs, aggregations)
  ✅ Handle 20% edge cases
  ✅ No feature limitations
  ✅ Flexibility when needed

Best of both worlds:
  🎯 80% of operations use safe, structured APIs
  🎯 20% complex cases use powerful SQL APIs
  🎯 Same security layer protects both
  🎯 Developers choose the right tool for each job
```

### Future Vision 🚀

**Generic Open Source Tool: `sqlite-p2p-sync`**

Extract the core sync logic into a generic open-source tool that can benefit the broader SQLite community while serving as the foundation for ENX's data synchronization needs.

**Target Timeline**: 8-12 weeks from start to open source release

**Expected Impact**:
- Help thousands of developers solve SQLite sync problems
- Build reputation in open source community
- Receive contributions and improvements from users
- Validate architecture with real-world use cases
- Create portfolio project demonstrating system design skills

### Existing Similar Projects 🔍

Before building from scratch, let's examine existing SQLite synchronization solutions:

#### 1. **Litestream** ⭐⭐⭐⭐⭐
- **URL**: https://litestream.io/
- **Approach**: Streaming replication to cloud storage (S3, Azure Blob, etc.)
- **Pros**:
  - ✅ Production-ready, battle-tested
  - ✅ Continuous replication (near real-time)
  - ✅ Point-in-time recovery
  - ✅ Written in Go (good performance)
- **Cons**:
  - ❌ Not P2P (requires cloud storage)
  - ❌ One-way replication (master → replica)
  - ❌ No conflict resolution (single writer only)
  - ❌ Doesn't work offline
- **Use Case**: Single-master with cloud backup, not suitable for multi-node sync

#### 2. **rqlite** ⭐⭐⭐⭐
- **URL**: https://github.com/rqlite/rqlite
- **Approach**: Distributed SQLite using Raft consensus
- **Pros**:
  - ✅ Multi-node cluster
  - ✅ Strong consistency (Raft)
  - ✅ Fault tolerance
  - ✅ HTTP API
- **Cons**:
  - ❌ Requires cluster (min 3 nodes)
  - ❌ Not offline-capable
  - ❌ Synchronous replication (higher latency)
  - ❌ Overkill for simple use cases
- **Use Case**: Distributed database cluster, not for offline P2P sync

#### 3. **LiteFS** ⭐⭐⭐⭐
- **URL**: https://github.com/superfly/litefs
- **Approach**: FUSE-based SQLite replication
- **Pros**:
  - ✅ Transparent replication
  - ✅ Multi-region support
  - ✅ Read replicas
  - ✅ Fast failover
- **Cons**:
  - ❌ Requires Consul for coordination
  - ❌ Single writer (no P2P)
  - ❌ Not offline-capable
  - ❌ FUSE overhead
- **Use Case**: Fly.io multi-region deployments, not for offline sync

#### 4. **cr-sqlite** ⭐⭐⭐⭐⭐
- **URL**: https://github.com/vlcn-io/cr-sqlite
- **Approach**: CRDT (Conflict-free Replicated Data Types) for SQLite
- **Pros**:
  - ✅ True multi-master
  - ✅ Offline-capable
  - ✅ Automatic conflict resolution
  - ✅ P2P sync ready
- **Cons**:
  - ⚠️ Requires schema changes (CRDT columns)
  - ⚠️ Complex CRDT semantics
  - ⚠️ Still in development (not 1.0)
  - ⚠️ SQLite extension (native code)
- **Use Case**: **Most similar to our needs**, but requires CRDT knowledge

#### 5. **ElectricSQL** ⭐⭐⭐⭐
- **URL**: https://electric-sql.com/
- **Approach**: Local-first SQLite with PostgreSQL sync
- **Pros**:
  - ✅ Offline-first
  - ✅ Multi-device sync
  - ✅ Conflict resolution
  - ✅ TypeScript SDK
- **Cons**:
  - ❌ Requires PostgreSQL backend
  - ❌ Not pure P2P (needs central server)
  - ❌ Complex setup
  - ❌ Opinionated architecture
- **Use Case**: Full-stack local-first apps with central DB

#### 6. **PouchDB/CouchDB** ⭐⭐⭐⭐
- **URL**: https://pouchdb.com/
- **Approach**: JavaScript document database with sync
- **Pros**:
  - ✅ Battle-tested sync protocol
  - ✅ Offline-first
  - ✅ Bidirectional sync
  - ✅ Conflict resolution
- **Cons**:
  - ❌ Not SQLite (document store)
  - ❌ JavaScript only
  - ❌ Different data model
  - ❌ Requires CouchDB server for multi-device
- **Use Case**: Web apps with offline sync, different paradigm

### Comparison Matrix

| Project | P2P | Offline | Conflict Resolution | SQLite Native | Complexity | Our Match |
|---------|-----|---------|-------------------|---------------|------------|-----------|
| **Litestream** | ❌ | ❌ | ❌ | ✅ | Low | ⭐⭐ |
| **rqlite** | ⚠️ (cluster) | ❌ | ✅ | ✅ | High | ⭐⭐ |
| **LiteFS** | ❌ | ❌ | ❌ | ✅ | Medium | ⭐⭐ |
| **cr-sqlite** | ✅ | ✅ | ✅ | ⚠️ (ext) | High | ⭐⭐⭐⭐⭐ |
| **ElectricSQL** | ❌ | ✅ | ✅ | ✅ | High | ⭐⭐⭐ |
| **PouchDB** | ✅ | ✅ | ✅ | ❌ | Medium | ⭐⭐ |
| **Our Design** | ✅ | ✅ | ✅ | ✅ | Medium | - |

### Why Build Our Own? 🤔

**None of the existing solutions perfectly match our requirements:**

```
Our Unique Requirements:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Must have:
  1. True P2P sync (no central server required)
  2. Offline-capable (network-isolated environments)
  3. Works with existing SQLite databases (no schema changes)
  4. Timestamp-based conflict resolution (simple, predictable)
  5. Configuration-driven (no code changes)
  6. Simple deployment (single binary)

Existing solutions fall short:
  • Litestream: Not P2P, requires cloud storage
  • rqlite: Needs cluster, not offline-capable
  • LiteFS: Single writer, needs Consul
  • cr-sqlite: ⭐ Close, but requires CRDT schema changes
  • ElectricSQL: Needs PostgreSQL, not pure P2P
  • PouchDB: Not SQLite, different data model

Our sweet spot:
  🎯 Simple timestamp-based sync (no CRDT complexity)
  🎯 Works with existing databases (no migration)
  🎯 P2P without infrastructure (direct node-to-node)
  🎯 Offline-first by design
  🎯 Configuration over code
```

**Closest Match: cr-sqlite**

If we don't want to build from scratch, **cr-sqlite** is the closest match:

```bash
# Using cr-sqlite (if we choose not to build)
Pros:
  ✅ Battle-tested CRDT implementation
  ✅ True P2P sync
  ✅ Offline-capable
  ✅ Automatic conflict resolution
  ✅ Active development

Cons:
  ⚠️ Requires modifying existing schema:
     ALTER TABLE words ADD COLUMN __crsql_version INTEGER;
     ALTER TABLE words ADD COLUMN __crsql_site_id BLOB;
  ⚠️ More complex than timestamp-based
  ⚠️ CRDT semantics can be confusing
  ⚠️ Requires C extension compilation

Decision:
  If simplicity > features → Build our own (timestamp-based)
  If features > simplicity → Use cr-sqlite (CRDT-based)
```

### Recommendation 💡

**Build Our Own, Learn from Existing Projects:**

```
Phase 1: MVP (4 weeks)
  • Study cr-sqlite's sync protocol
  • Borrow Litestream's WAL streaming approach
  • Implement simple timestamp-based sync
  • Prove concept with ENX

Phase 2: Production (4 weeks)
  • Add cr-sqlite's CRDT as optional advanced mode
  • Learn from rqlite's consistency guarantees
  • Implement LiteFS's failover patterns
  • Battle-test with real usage

Phase 3: Open Source (4 weeks)
  • Document differences from existing solutions
  • Explain why timestamp-based is simpler
  • Provide migration paths from other tools
  • Build community around simplicity

Total: 12 weeks to production-ready open source tool
```

**Unique Value Proposition:**

```
Our Tool vs. Existing Solutions:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Litestream: "We do P2P, not cloud-only"
rqlite: "We work offline, not cluster-only"
LiteFS: "We support multi-writer, not single-writer"
cr-sqlite: "We're simpler, no schema changes needed"
ElectricSQL: "We're pure P2P, no server required"
PouchDB: "We're SQLite-native, not document store"

Our niche:
  🎯 Simplest P2P sync for existing SQLite databases
  🎯 Zero schema changes, zero infrastructure
  🎯 Works offline, syncs when online
  🎯 Configuration over code
```

## Appendix: Alternative Protocol Options

### Option 1: Pure gRPC ⭐⭐⭐⭐⭐

**Advantages**:
- ✅ High performance (binary protocol, HTTP/2)
- ✅ Strong typing (Protocol Buffers)
- ✅ Built-in code generation (client/server)
- ✅ Streaming support (real-time sync)
- ✅ Cross-language support
- ✅ Automatic serialization/deserialization

**Disadvantages**:
- ⚠️ Slightly more complex setup than REST
- ⚠️ Requires .proto file definitions
- ⚠️ More difficult to debug (binary protocol)

**Use Cases**:
- **Inter-service communication** (enx-api ↔ enx-data-service)
- **Node-to-node sync** (data-service ↔ data-service)
- High-frequency, low-latency operations

**Example Proto Definition**:

```protobuf
syntax = "proto3";

package enx.data;

service DataService {
  // Word operations
  rpc GetWord(GetWordRequest) returns (Word);
  rpc CreateWord(CreateWordRequest) returns (Word);
  rpc UpdateWord(UpdateWordRequest) returns (Word);
  rpc SearchWords(SearchWordsRequest) returns (SearchWordsResponse);

  // User dict operations
  rpc GetUserWords(GetUserWordsRequest) returns (GetUserWordsResponse);
  rpc MarkWord(MarkWordRequest) returns (Word);

  // Sync operations
  rpc GetChanges(GetChangesRequest) returns (stream Change);
  rpc PushChanges(stream Change) returns (PushChangesResponse);
}

message Word {
  int64 id = 1;
  string english = 2;
  string chinese = 3;
  string pronunciation = 4;
  string update_datetime = 5;
  int32 load_count = 6;
}

message GetWordRequest {
  string english = 1;
}

message GetChangesRequest {
  string since = 1;  // RFC3339 timestamp
  repeated string tables = 2;
}

message Change {
  string table = 1;
  string action = 2;  // insert, update, delete
  string data = 3;    // JSON payload
  string timestamp = 4;
}
```

**Why not chosen**: While gRPC offers excellent performance, the lack of easy debugging capabilities (binary protocol) makes it harder to troubleshoot issues during development and operations. The hybrid approach provides the same performance benefits while maintaining REST endpoints for debugging.

### Option 2: Pure REST/HTTP+JSON ⭐⭐⭐⭐

**Advantages**:
- ✅ Simple and familiar
- ✅ Easy to debug (curl, browser)
- ✅ Human-readable (JSON)
- ✅ Wide tooling support
- ✅ No code generation needed

**Disadvantages**:
- ⚠️ Lower performance than gRPC
- ⚠️ No strong typing (runtime errors)
- ⚠️ Larger payload size (text vs binary)
- ⚠️ No streaming support (polling required)

**Use Cases**:
- Development and debugging
- Admin/monitoring endpoints
- Less critical operations

**Example API**:

```http
# Word operations
GET  /api/v1/words/:word
POST /api/v1/words
PUT  /api/v1/words/:id

# User dict operations
GET  /api/v1/user-dicts/:userId/words
POST /api/v1/user-dicts/mark

# Sync operations
GET  /api/v1/sync/changes?since=2025-11-12T10:00:00Z
POST /api/v1/sync/push
```

**Why not chosen**: REST is great for simplicity but lacks the performance and streaming capabilities needed for efficient P2P sync operations. For a data synchronization service handling frequent updates, gRPC's binary protocol and streaming support are essential. The hybrid approach keeps REST for non-critical operations while using gRPC where performance matters.

## References

- [gRPC Documentation](https://grpc.io/docs/)
- [Protocol Buffers](https://developers.google.com/protocol-buffers)
- [Microservices Patterns](https://microservices.io/patterns/)
- [Database Replication Strategies](https://en.wikipedia.org/wiki/Replication_(computing))
