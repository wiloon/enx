# ENX API

### Billing startup

The durable billing path is always enabled (ADR-067). A fresh database is initialized with the current schema. An already initialized, supported database can be reopened. Legacy billing databases and unsupported schema versions are rejected before any writes or background workers; export the old database and initialize a fresh database during the owner-controlled release. The application never resets a database automatically.
