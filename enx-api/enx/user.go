package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/password"
	"enx-api/utils/sqlitex"
	"time"

	"github.com/google/uuid"
)

type User struct {
	Id            string    `json:"id" gorm:"column:id;primaryKey"`
	Name          string    `json:"name" gorm:"column:name"`
	Email         string    `json:"email" gorm:"column:email"`
	Password      string    `json:"-" gorm:"column:password"`
	CreateTime    time.Time `json:"create_time" gorm:"column:created_at"`
	UpdateTime    time.Time `json:"update_time" gorm:"column:updated_at"`
	LastLoginTime time.Time `json:"last_login_time" gorm:"column:last_login_time"`
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
