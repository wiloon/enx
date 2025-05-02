package enx

import (
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"time"
)

type User struct {
	Id            int64     `json:"id"`
	Name          string    `json:"name"`
	Password      string    `json:"-"`
	CreateTime    time.Time `json:"create_time"`
	UpdateTime    time.Time `json:"update_time"`
	LastLoginTime time.Time `json:"last_login_time"`
}

func (u *User) Login() bool {
	sqlitex.DB.Where("name COLLATE NOCASE = ?", u.Name).Find(&u)
	logger.Infof("get user by name: %+v", u)
	if u.Id == 0 {
		logger.Errorf("user not exist: %s", u.Name)
		return false
	}
	return true
} 