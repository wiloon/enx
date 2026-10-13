# enx-api design reference

The rules (handlers do HTTP only, business rules in domain services, SQL in `repo/`, dependencies injected as interfaces, ECDICT read-only, one lookup entry point) are in [AGENTS.md](../../AGENTS.md) §enx-api. This file holds the worked examples behind them. Testing these layers: [testing.md](testing.md).

## Domain-Driven Design

### 1. Layer Separation

```
enx-api/
├── handlers/      # HTTP handlers (presentation layer)
├── enx/          # Domain logic and entities
├── dictionary/, billing/, stats/, …  # Domain packages, one per domain concept
├── repo/         # Repository pattern (data access)
├── utils/        # Shared utilities
└── middleware/   # Cross-cutting concerns
```

**Rules:**
- **Handlers** should only handle HTTP concerns (request/response, validation)
- **Domain layer** (`enx/`) contains business logic and entities
- **Repository** (`repo/`) handles all database operations
- Never put business logic in handlers or repositories

### 2. Repository Pattern

**Purpose:** Abstract data access from business logic

**Guidelines:**
- Create repository interfaces in the domain layer
- Implement repositories in the `repo/` package
- Repository methods should return domain entities, not database models
- Use descriptive method names: `GetUserByID`, `FindActiveWords`, `SaveUserDict`

**Example:**
```go
// enx/user_repository.go (interface)
type UserRepository interface {
    GetByID(id string) (*User, error)
    GetByName(name string) (*User, error)
    Create(user *User) error
    Update(user *User) error
}

// repo/user_repo.go (implementation)
type userRepository struct {
    db *gorm.DB
}

func NewUserRepository(db *gorm.DB) enx.UserRepository {
    return &userRepository{db: db}
}
```

### 3. Service Layer

**Purpose:** Encapsulate business logic and orchestrate operations

**Guidelines:**
- Create services in the domain layer (`enx/` package)
- Services coordinate between repositories and contain business rules
- Keep services focused on a single domain concept
- Services should be testable without database (use repository interfaces)

**Example:**
```go
// enx/user_service.go
type UserService struct {
    repo UserRepository
}

func (s *UserService) RegisterUser(name, email, password string) (*User, error) {
    // Business logic here
    // Password hashing, validation, etc.
    // Then use repository to persist
}
```

### 4. Domain Entities

**Purpose:** Represent core business concepts

**Guidelines:**
- Define entities in the domain layer (`enx/` package)
- Entities should have behavior, not just data (methods that express domain operations)
- Keep database concerns separate (use separate structs for DB models if needed)
- Entities should be independent of frameworks (GORM, HTTP, etc.)

**Example:**
```go
// enx/user.go
type User struct {
    ID        string
    Name      string
    Email     string
    Password  string
    CreatedAt time.Time
    UpdatedAt time.Time
}

// Domain behavior
func (u *User) IsPasswordValid(password string) bool {
    // Business logic for password validation
}

func (u *User) UpdateLastLogin() {
    u.LastLoginTime = time.Now()
}
```

### 5. Value Objects

**Purpose:** Immutable objects defined by their attributes

**Guidelines:**
- Use value objects for concepts without identity (e.g., Address, Email, PhoneNumber)
- Make them immutable
- Include validation in constructor
- Prefer value objects over primitive types for domain concepts

**Example:**
```go
// enx/email.go
type Email struct {
    value string
}

func NewEmail(email string) (Email, error) {
    if !isValidEmail(email) {
        return Email{}, errors.New("invalid email format")
    }
    return Email{value: email}, nil
}

func (e Email) String() string {
    return e.value
}
```

### 6. Dependency Injection

**Guidelines:**
- Use constructor functions to inject dependencies
- Prefer interfaces over concrete types
- Make dependencies explicit in constructors

**Example:**
```go
// handlers/user_handler.go
type UserHandler struct {
    userService *enx.UserService
    logger      *zap.Logger
}

func NewUserHandler(userService *enx.UserService, logger *zap.Logger) *UserHandler {
    return &UserHandler{
        userService: userService,
        logger:      logger,
    }
}
```

## When to apply DDD

- ✅ **Use DDD for:** New features, refactoring existing code, complex business logic
- ✅ **Repository Pattern:** All database operations
- ✅ **Service Layer:** Multi-step operations, business rules
- ⚠️ **Keep simple things simple:** Don't over-engineer trivial CRUD operations
- ⚠️ **Pragmatic approach:** Adapt patterns to project needs, not dogma

## ECDICT is read-only

[ECDICT](https://github.com/skywind3000/ECDICT) is a **third-party open-source**
English–Chinese dictionary dataset (see `docs/adr/0001-integrate-ecdict-dictionary.md`).
It ships as a standalone SQLite file, mounted separately from the application
image and the application database, and the connection is opened `mode=ro`
(`enx-api/ecdict/ecdict.go`).

**The application layer treats ECDICT as strictly read-only.** Never:

- write to, update, or delete rows in the `stardict` table
- run schema migrations / `AutoMigrate` against the ECDICT database
- open the ECDICT connection in read-write mode

Any word data the application *owns* — corrections, per-user progress and query
counts, phrase entries, cross-reference fixes — lives in the application's own
tables (`words`, `user_dicts`, …), keyed to ECDICT by lookup. If an ECDICT
entry is wrong or missing, the fix goes in an application-side table, never in
ECDICT. This keeps ECDICT a drop-in, independently-updatable dataset: a new
upstream release can replace the file wholesale with no migration.

The single word-lookup entry point is `dictionary.Service.Resolve` (ADR-018): it reads
the application's `words` table first (case-insensitive, straight apostrophes:
ADR-043), then ECDICT (caching a hit in `words`),
and meters the lookup; callers do not touch `ecdict` directly. Per-user review
bookkeeping (`user_dicts`) stays with the caller (`repo.RecordWordLookup`).
