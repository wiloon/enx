package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/password"
	"enx-api/utils/sqlitex"
	"time"

	"github.com/google/uuid"
)

type User struct {
	Id                  string    `json:"id" gorm:"column:id;primaryKey"`
	ClerkUserID         string    `json:"-" gorm:"column:clerk_user_id;uniqueIndex"`
	Name                string    `json:"name" gorm:"column:name"`
	Email               string    `json:"email" gorm:"column:email"`
	Password            string    `json:"-" gorm:"column:password"`
	Status              string    `json:"status" gorm:"column:status;default:pending"`
	VerificationToken   string    `json:"-" gorm:"column:verification_token"`
	TokenExpiresAt      time.Time `json:"-" gorm:"column:token_expires_at"`
	ResetToken          string    `json:"-" gorm:"column:reset_token"`
	ResetTokenExpiresAt time.Time `json:"-" gorm:"column:reset_token_expires_at"`
	CreateTime          time.Time `json:"createdAt" gorm:"column:created_at"`
	UpdateTime          time.Time `json:"update_time" gorm:"column:updated_at"`
	LastLoginTime       time.Time `json:"last_login_time" gorm:"column:last_login_time"`
	AvatarUrl           string    `json:"avatarUrl" gorm:"column:avatar_url"`
}

func (u *User) Login() bool {
	tmpUser := GeUserByName(u.Name)
	if tmpUser.Id == "" {
		logger.Errorf("login failed: user does not exist, username: %s", u.Name)
		logger.Infof("user not found in database, username: %s", u.Name)
		return false
	}

	// Verify password
	match, err := password.VerifyPassword(u.Password, tmpUser.Password)
	if err != nil {
		logger.Errorf("password verification failed: %v", err)
		return false
	}
	if !match {
		logger.Errorf("password mismatch for user: %s", u.Name)
		return false
	}

	u.Id = tmpUser.Id
	u.LastLoginTime = tmpUser.LastLoginTime
	u.Status = tmpUser.Status
	logger.Infof("user login, user: %s, login success, user: %+v", u.Name, tmpUser)
	return true
}

func GeUserByName(name string) *User {
	user := User{}
	sqlitex.DB.Where("name=?", name).Find(&user)
	logger.Debugf("find user, name: %s, obj: %+v", name, user)
	return &user
}

// Create creates a new user
func (u *User) Create() error {
	if u.Id == "" {
		u.Id = uuid.New().String()
	}
	u.CreateTime = time.Now()
	u.UpdateTime = time.Now()
	return sqlitex.DB.Create(u).Error
}

// GetUserByEmail looks up a user by email address.
func GetUserByEmail(email string) *User {
	user := User{}
	sqlitex.DB.Where("email = ?", email).First(&user)
	return &user
}

// GetUsersByEmail returns every user with exactly this email: users.email
// is not unique (ADR-015, 2026-10-20 note §4).
func GetUsersByEmail(email string) ([]User, error) {
	var users []User
	err := sqlitex.DB.Where("email = ?", email).Order("created_at, id").Find(&users).Error
	return users, err
}

// GetUserByID looks up a user by their ID.
func GetUserByID(id string) *User {
	user := User{}
	sqlitex.DB.Where("id = ?", id).First(&user)
	return &user
}

// Activate sets the user status to active and clears the verification token.
func (u *User) Activate() error {
	return sqlitex.DB.Model(u).Updates(map[string]interface{}{
		"status":             "active",
		"verification_token": nil,
		"token_expires_at":   nil,
		"updated_at":         time.Now(),
	}).Error
}

// SetStatus sets users.status: "active" or "disabled" (ADR-062 Decision 5).
func (u *User) SetStatus(status string) error {
	return sqlitex.DB.Model(u).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error
}

// SetVerificationToken assigns a new verification token and expiry.
func (u *User) SetVerificationToken(token string, expiresAt time.Time) error {
	return sqlitex.DB.Model(u).Updates(map[string]interface{}{
		"verification_token": token,
		"token_expires_at":   expiresAt,
		"updated_at":         time.Now(),
	}).Error
}

// SetResetToken assigns a new password reset token and expiry.
func (u *User) SetResetToken(token string, expiresAt time.Time) error {
	return sqlitex.DB.Model(u).Updates(map[string]interface{}{
		"reset_token":            token,
		"reset_token_expires_at": expiresAt,
		"updated_at":             time.Now(),
	}).Error
}

// UpdatePassword hashes and saves a new password, clearing the reset token.
func (u *User) UpdatePassword(newPassword string) error {
	hashed, err := password.HashPassword(newPassword)
	if err != nil {
		return err
	}
	return sqlitex.DB.Model(u).Updates(map[string]interface{}{
		"password":               hashed,
		"reset_token":            nil,
		"reset_token_expires_at": nil,
		"updated_at":             time.Now(),
	}).Error
}
