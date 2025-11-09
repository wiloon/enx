package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/password"
	"enx-api/utils/sqlitex"
	"time"
)

type User struct {
	Id            int64     `json:"id"`
	Name          string    `json:"name"`
	Email         string    `json:"email"`
	Password      string    `json:"-"`
	CreateTime    time.Time `json:"create_time"`
	UpdateTime    time.Time `json:"update_time"`
	LastLoginTime time.Time `json:"last_login_time"`
}

func (u *User) Login() bool {
	tmpUser := GeUserByName(u.Name)
	if tmpUser.Id == 0 {
		logger.Errorf("user login, user not exist: %s", u.Name)
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
	u.CreateTime = time.Now()
	u.UpdateTime = time.Now()
	return sqlitex.DB.Create(u).Error
}
