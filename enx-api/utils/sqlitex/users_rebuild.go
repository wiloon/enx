package sqlitex

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	zapLog "enx-api/utils/logger"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ADR-015 (2026-10-20 note §4, owner approval 2026-10-22): users.email and
// users.name are profile attributes, not identity keys. Databases created
// before #211 carry single-column UNIQUE constraints or indexes on them,
// which AutoMigrate never removes, so rebuildUsersWithoutProfileUniqueness
// rebuilds users without them, following SQLite's generalized ALTER TABLE
// procedure (https://www.sqlite.org/lang_altertable.html#otheralter).

// profileColumns are the users columns that must not be unique.
var profileColumns = map[string]bool{"email": true, "name": true}

// usersRebuild holds what the rebuild needs besides the database: the clock
// that names the backup, and a hook tests use to fail or tamper after a step.
type usersRebuild struct {
	now       func() time.Time
	afterStep func(step string, tx *gorm.DB) error
}

// Steps afterStep hears about, in order.
const (
	stepCopied   = "copied"  // users_new holds every row
	stepRenamed  = "renamed" // users_new is now users
	stepRebuilt  = "rebuilt" // indexes and triggers are back
	backupSuffix = ".pre-users-rebuild-"
)

// rebuildUsersWithoutProfileUniqueness removes single-column uniqueness on
// users.email and users.name. It does nothing (and writes no backup) when
// there is none. Otherwise it backs the database up with VACUUM INTO,
// rebuilds users from its live DDL in one transaction, and returns the backup
// path. Any failure, including DDL it cannot safely rewrite, is returned
// without the rebuild having happened.
func rebuildUsersWithoutProfileUniqueness(db *gorm.DB) (string, error) {
	return usersRebuild{now: time.Now}.run(db)
}

func (r usersRebuild) run(db *gorm.DB) (string, error) {
	plan, err := planUsersRebuild(db)
	if err != nil || plan == nil {
		return "", err
	}

	backup, err := backupDatabase(db, r.now())
	if err != nil {
		return "", fmt.Errorf("users rebuild: backup failed, users left as they are: %w", err)
	}
	zapLog.Warnf("users rebuild: removing UNIQUE from users.email/users.name; backup written to %s (keep it until the release is verified)", backup)

	if err := db.Connection(func(conn *gorm.DB) error { return r.rebuild(conn, plan) }); err != nil {
		return backup, fmt.Errorf("users rebuild: %w (backup at %s)", err, backup)
	}
	zapLog.Infof("users rebuild: done; %d rows kept", plan.rows)
	return backup, nil
}

// usersPlan is what inspecting the live schema found.
type usersPlan struct {
	newTableSQL string   // CREATE TABLE users_new, without profile uniqueness
	columns     []string // every stored column, copied by name
	recreate    []string // users' own index and trigger SQL, run after the rename
	// dependents are the views, and the triggers on other tables, that use
	// users (directly or through another view), in creation order. The
	// rename can't parse them while users is gone, so they are dropped
	// first and recreated from their own SQL afterwards (steps 3, 8 and 9).
	dependents []schemaObject
	rows       int64
}

type schemaObject struct {
	Type string
	Name string
	Sql  string
}

// usersDependents finds the views and other tables' triggers that mention
// users, or a view that does.
func usersDependents(db *gorm.DB) ([]schemaObject, error) {
	var objects []struct {
		Type    string
		Name    string
		TblName string
		Sql     string
	}
	if err := db.Raw(`SELECT type, name, tbl_name, sql FROM sqlite_schema
		WHERE type IN ('view', 'trigger') AND tbl_name != 'users' AND sql IS NOT NULL
		ORDER BY rowid`).Scan(&objects).Error; err != nil {
		return nil, err
	}
	used := map[string]bool{"users": true}
	picked := make([]bool, len(objects))
	for changed := true; changed; {
		changed = false
		for i, o := range objects {
			if picked[i] {
				continue
			}
			mentions := used[strings.ToLower(o.TblName)]
			for _, t := range tokenizeSQL(o.Sql) {
				if t.isIdent() && used[t.ident()] {
					mentions = true
				}
			}
			if mentions {
				picked[i], changed = true, true
				if o.Type == "view" {
					used[strings.ToLower(o.Name)] = true
				}
			}
		}
	}
	var out []schemaObject
	for i, o := range objects {
		if picked[i] {
			out = append(out, schemaObject{Type: o.Type, Name: o.Name, Sql: o.Sql})
		}
	}
	return out, nil
}

type indexInfo struct {
	name    string
	unique  bool
	origin  string // "c" CREATE INDEX, "u" UNIQUE constraint, "pk" PRIMARY KEY
	partial bool
	cols    []string // lower-cased; "" for an expression
	sql     string
}

// isProfileUnique is a full single-column unique index on email or name.
func (ix indexInfo) isProfileUnique() bool {
	return ix.unique && !ix.partial && len(ix.cols) == 1 && profileColumns[ix.cols[0]]
}

// isUnclassifiable is a unique index touching email or name that is neither
// a plain single-column one nor clearly something else: partial, or keyed on
// an expression.
func (ix indexInfo) isUnclassifiable() bool {
	if !ix.unique || ix.isProfileUnique() {
		return false
	}
	expr := false
	for _, c := range ix.cols {
		if c == "" {
			expr = true
		}
	}
	if !ix.partial && !expr {
		return false
	}
	if len(ix.cols) == 1 && profileColumns[ix.cols[0]] {
		return true
	}
	for _, t := range tokenizeSQL(ix.sql) {
		if t.isIdent() && profileColumns[t.ident()] {
			return true
		}
	}
	return false
}

func listUsersIndexes(db *gorm.DB, table string) ([]indexInfo, error) {
	var list []struct {
		Name    string
		Unique  int
		Origin  string
		Partial int
	}
	if err := db.Raw(fmt.Sprintf("PRAGMA index_list(%s)", quoteIdent(table))).Scan(&list).Error; err != nil {
		return nil, err
	}
	out := make([]indexInfo, 0, len(list))
	for _, l := range list {
		ix := indexInfo{name: l.Name, unique: l.Unique == 1, origin: l.Origin, partial: l.Partial == 1}
		var cols []struct {
			Seqno int
			Cid   int
			Name  *string
		}
		if err := db.Raw(fmt.Sprintf("PRAGMA index_info(%s)", quoteIdent(l.Name))).Scan(&cols).Error; err != nil {
			return nil, err
		}
		sort.Slice(cols, func(i, j int) bool { return cols[i].Seqno < cols[j].Seqno })
		for _, c := range cols {
			if c.Name == nil || c.Cid < 0 {
				ix.cols = append(ix.cols, "")
			} else {
				ix.cols = append(ix.cols, strings.ToLower(*c.Name))
			}
		}
		if err := db.Raw(`SELECT COALESCE(sql, '') FROM sqlite_schema WHERE type = 'index' AND name = ?`, l.Name).Scan(&ix.sql).Error; err != nil {
			return nil, err
		}
		out = append(out, ix)
	}
	return out, nil
}

type columnInfo struct {
	Cid       int
	Name      string
	Type      string
	Notnull   int
	DfltValue *string
	Pk        int
	Hidden    int
}

func tableColumns(db *gorm.DB, table string) ([]columnInfo, error) {
	var cols []columnInfo
	err := db.Raw(fmt.Sprintf("PRAGMA table_xinfo(%s)", quoteIdent(table))).Scan(&cols).Error
	return cols, err
}

// planUsersRebuild inspects users; nil when there is nothing to do.
func planUsersRebuild(db *gorm.DB) (*usersPlan, error) {
	var ddl string
	if err := db.Raw(`SELECT COALESCE(sql, '') FROM sqlite_schema WHERE type = 'table' AND name = 'users'`).Scan(&ddl).Error; err != nil {
		return nil, fmt.Errorf("users rebuild: read users DDL: %w", err)
	}
	if ddl == "" {
		return nil, nil
	}
	indexes, err := listUsersIndexes(db, "users")
	if err != nil {
		return nil, fmt.Errorf("users rebuild: list users indexes: %w", err)
	}
	needed := false
	dropIndex := map[string]bool{}
	for _, ix := range indexes {
		if ix.isUnclassifiable() {
			return nil, fmt.Errorf("users rebuild: cannot classify unique index %q on users (%s); fix it by hand before starting", ix.name, ix.sql)
		}
		if !ix.isProfileUnique() {
			continue
		}
		needed = true
		switch ix.origin {
		case "c":
			dropIndex[ix.name] = true
		case "u":
		default:
			return nil, fmt.Errorf("users rebuild: unique index %q on users has origin %q; fix it by hand before starting", ix.name, ix.origin)
		}
	}
	if !needed {
		return nil, nil
	}

	newDDL, err := rewriteUsersDDL(ddl, "users_new")
	if err != nil {
		return nil, fmt.Errorf("users rebuild: %w", err)
	}
	cols, err := tableColumns(db, "users")
	if err != nil {
		return nil, fmt.Errorf("users rebuild: read users columns: %w", err)
	}
	if err := checkRewrittenDDL(newDDL, cols, indexes); err != nil {
		return nil, fmt.Errorf("users rebuild: rewritten DDL rejected: %w", err)
	}

	plan := &usersPlan{newTableSQL: newDDL}
	hasID := false
	for _, c := range cols {
		// Generated columns (hidden 2 and 3) are computed, not copied.
		if c.Hidden == 2 || c.Hidden == 3 {
			continue
		}
		plan.columns = append(plan.columns, c.Name)
		if strings.EqualFold(c.Name, "id") {
			hasID = true
		}
	}
	if !hasID {
		return nil, errors.New("users rebuild: users has no id column")
	}

	var objects []struct {
		Type string
		Name string
		Sql  string
	}
	if err := db.Raw(`SELECT type, name, sql FROM sqlite_schema
		WHERE tbl_name = 'users' AND type IN ('index', 'trigger') AND sql IS NOT NULL
		ORDER BY type, name`).Scan(&objects).Error; err != nil {
		return nil, fmt.Errorf("users rebuild: read users indexes and triggers: %w", err)
	}
	for _, o := range objects {
		if o.Type == "index" && dropIndex[o.Name] {
			continue
		}
		plan.recreate = append(plan.recreate, o.Sql)
	}
	if plan.dependents, err = usersDependents(db); err != nil {
		return nil, fmt.Errorf("users rebuild: read views and triggers that use users: %w", err)
	}
	if err := db.Raw(`SELECT count(*) FROM users`).Scan(&plan.rows).Error; err != nil {
		return nil, fmt.Errorf("users rebuild: count users: %w", err)
	}
	return plan, nil
}

// checkRewrittenDDL creates the rewritten table in a scratch in-memory
// database and checks that it has exactly the live table's columns and every
// uniqueness constraint except the single-column ones on email and name.
func checkRewrittenDDL(newDDL string, liveCols []columnInfo, liveIndexes []indexInfo) error {
	scratch, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return err
	}
	sqlDB, err := scratch.DB()
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()
	sqlDB.SetMaxOpenConns(1)

	if err := scratch.Exec(newDDL).Error; err != nil {
		return err
	}
	cols, err := tableColumns(scratch, "users_new")
	if err != nil {
		return err
	}
	if got, want := columnsKey(cols), columnsKey(liveCols); got != want {
		return fmt.Errorf("columns differ: got %s, want %s", got, want)
	}
	indexes, err := listUsersIndexes(scratch, "users_new")
	if err != nil {
		return err
	}
	var got, want []string
	for _, ix := range indexes {
		if ix.isProfileUnique() {
			return fmt.Errorf("unique index on %s survived the rewrite", ix.cols[0])
		}
		got = append(got, constraintKey(ix))
	}
	for _, ix := range liveIndexes {
		if ix.origin == "c" || ix.isProfileUnique() {
			continue
		}
		want = append(want, constraintKey(ix))
	}
	sort.Strings(got)
	sort.Strings(want)
	if fmt.Sprint(got) != fmt.Sprint(want) {
		return fmt.Errorf("constraints differ: got %v, want %v", got, want)
	}
	return nil
}

func columnsKey(cols []columnInfo) string {
	var b strings.Builder
	for _, c := range cols {
		dflt := "<null>"
		if c.DfltValue != nil {
			dflt = *c.DfltValue
		}
		fmt.Fprintf(&b, "%d|%s|%s|%d|%s|%d|%d;", c.Cid, c.Name, c.Type, c.Notnull, dflt, c.Pk, c.Hidden)
	}
	return b.String()
}

func constraintKey(ix indexInfo) string {
	return fmt.Sprintf("%s/%v/%v/%s", ix.origin, ix.unique, ix.partial, strings.Join(ix.cols, ","))
}

// backupDatabase writes a VACUUM INTO copy next to the main database file.
func backupDatabase(db *gorm.DB, at time.Time) (string, error) {
	var files []struct {
		Name string
		File string
	}
	if err := db.Raw(`PRAGMA database_list`).Scan(&files).Error; err != nil {
		return "", err
	}
	main := ""
	for _, f := range files {
		if f.Name == "main" {
			main = f.File
		}
	}
	if main == "" {
		return "", errors.New("the database has no file to back up")
	}
	path := main + backupSuffix + at.UTC().Format("20060102T150405Z")
	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("%s already exists", path)
	}
	if err := db.Exec(`VACUUM INTO ?`, path).Error; err != nil {
		return "", err
	}
	return path, nil
}

// rebuild runs SQLite's generalized ALTER TABLE procedure on one connection:
// foreign keys off outside the transaction, the rebuild and its checks
// inside it, and the original foreign-key setting restored either way.
func (r usersRebuild) rebuild(conn *gorm.DB, plan *usersPlan) (err error) {
	var fk int
	if err := conn.Raw(`PRAGMA foreign_keys`).Scan(&fk).Error; err != nil {
		return fmt.Errorf("read foreign_keys: %w", err)
	}
	if err := conn.Exec(`PRAGMA foreign_keys = OFF`).Error; err != nil {
		return fmt.Errorf("turn foreign_keys off: %w", err)
	}
	defer func() {
		if restoreErr := conn.Exec(fmt.Sprintf(`PRAGMA foreign_keys = %d`, fk)).Error; restoreErr != nil {
			err = errors.Join(err, fmt.Errorf("restore foreign_keys = %d: %w", fk, restoreErr))
		}
	}()

	return conn.Transaction(func(tx *gorm.DB) error {
		cols := make([]string, len(plan.columns))
		for i, c := range plan.columns {
			cols[i] = quoteIdent(c)
		}
		list := strings.Join(cols, ", ")
		if err := tx.Exec(plan.newTableSQL).Error; err != nil {
			return fmt.Errorf("create users_new: %w", err)
		}
		if err := tx.Exec(fmt.Sprintf(`INSERT INTO users_new (%s) SELECT %s FROM users`, list, list)).Error; err != nil {
			return fmt.Errorf("copy users: %w", err)
		}
		if err := r.step(stepCopied, tx); err != nil {
			return err
		}
		if err := verifySameUsers(tx); err != nil {
			return err
		}
		seq, err := usersSequence(tx)
		if err != nil {
			return err
		}
		for i := len(plan.dependents) - 1; i >= 0; i-- {
			d := plan.dependents[i]
			if err := tx.Exec(fmt.Sprintf("DROP %s %s", strings.ToUpper(d.Type), quoteIdent(d.Name))).Error; err != nil {
				return fmt.Errorf("drop %s %s: %w", d.Type, d.Name, err)
			}
		}
		if err := tx.Exec(`DROP TABLE users`).Error; err != nil {
			return fmt.Errorf("drop users: %w", err)
		}
		if err := tx.Exec(`ALTER TABLE users_new RENAME TO users`).Error; err != nil {
			return fmt.Errorf("rename users_new: %w", err)
		}
		if seq != nil {
			res := tx.Exec(`UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'users'`, *seq)
			if res.Error != nil {
				return fmt.Errorf("restore users' AUTOINCREMENT sequence: %w", res.Error)
			}
			if res.RowsAffected != 1 {
				return errors.New("restore users' AUTOINCREMENT sequence: the rebuilt users has none")
			}
		}
		if err := r.step(stepRenamed, tx); err != nil {
			return err
		}
		for _, sql := range plan.recreate {
			if err := tx.Exec(sql).Error; err != nil {
				return fmt.Errorf("recreate %q: %w", sql, err)
			}
		}
		for _, d := range plan.dependents {
			if err := tx.Exec(d.Sql).Error; err != nil {
				return fmt.Errorf("recreate %s %s: %w", d.Type, d.Name, err)
			}
		}
		if err := r.step(stepRebuilt, tx); err != nil {
			return err
		}
		var rows int64
		if err := tx.Raw(`SELECT count(*) FROM users`).Scan(&rows).Error; err != nil {
			return err
		}
		if rows != plan.rows {
			return fmt.Errorf("verify: users has %d rows after the rebuild, want %d", rows, plan.rows)
		}
		var violations []map[string]any
		if err := tx.Raw(`PRAGMA foreign_key_check`).Scan(&violations).Error; err != nil {
			return fmt.Errorf("foreign_key_check: %w", err)
		}
		if len(violations) > 0 {
			return fmt.Errorf("verify: foreign_key_check reports %d violations, first %v", len(violations), violations[0])
		}
		return nil
	})
}

// usersSequence reads users' AUTOINCREMENT high-water mark, which DROP TABLE
// deletes; nil when users has none.
func usersSequence(tx *gorm.DB) (*int64, error) {
	var tables int64
	if err := tx.Raw(`SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'`).Scan(&tables).Error; err != nil {
		return nil, fmt.Errorf("read users' AUTOINCREMENT sequence: %w", err)
	}
	if tables == 0 {
		return nil, nil
	}
	var seqs []int64
	if err := tx.Raw(`SELECT seq FROM sqlite_sequence WHERE name = 'users'`).Scan(&seqs).Error; err != nil {
		return nil, fmt.Errorf("read users' AUTOINCREMENT sequence: %w", err)
	}
	if len(seqs) == 0 {
		return nil, nil
	}
	return &seqs[0], nil
}

// verifySameUsers checks that users_new holds the same number of rows and
// the same set of ids as users.
func verifySameUsers(tx *gorm.DB) error {
	var oldRows, newRows, missing, extra int64
	for _, q := range []struct {
		sql string
		dst *int64
	}{
		{`SELECT count(*) FROM users`, &oldRows},
		{`SELECT count(*) FROM users_new`, &newRows},
		{`SELECT count(*) FROM (SELECT id FROM users EXCEPT SELECT id FROM users_new)`, &missing},
		{`SELECT count(*) FROM (SELECT id FROM users_new EXCEPT SELECT id FROM users)`, &extra},
	} {
		if err := tx.Raw(q.sql).Scan(q.dst).Error; err != nil {
			return fmt.Errorf("verify: %w", err)
		}
	}
	if oldRows != newRows || missing != 0 || extra != 0 {
		return fmt.Errorf("verify: users_new differs from users: %d rows against %d; %d ids missing, %d extra", newRows, oldRows, missing, extra)
	}
	return nil
}

func (r usersRebuild) step(name string, tx *gorm.DB) error {
	if r.afterStep == nil {
		return nil
	}
	return r.afterStep(name, tx)
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
