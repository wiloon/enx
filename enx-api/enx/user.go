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
	tmpUser := GeUserByName(u.Name)
	if tmpUser.Id == 0 {
		logger.Errorf("user login, user not exist: %s", tmpUser.Name)
		return false
	}else{
		u.Id = tmpUser.Id
		u.LastLoginTime = tmpUser.LastLoginTime
	}
	logger.Infof("user login, user: %s, login success, user: %+v", u.Name, tmpUser)
	return true
}

func GeUserByName(name string) *User {
	user := User{}
	sqlitex.DB.Where("name=?", name).Find(&user)
	logger.Debugf("find user, name: %s, obj: %+v", name, user)
	return &user
}