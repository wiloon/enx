package password

import (
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"strings"
)

type User struct {
	Id       int64
	Name     string
	Password string
}

func MigratePasswords() error {
	var users []User
	users = append(users, User{
		Id:       1,
		Name:     "wiloon",
		Password: "password_0",
	})

	for _, user := range users {
		// Check if password is already in Argon2 format
		if strings.HasPrefix(user.Password, "$argon2id$") {
			continue
		}

		// Hash the plaintext password
		hashedPassword, err := HashPassword(user.Password)
		if err != nil {
			logger.Errorf("failed to hash password for user %s: %v", user.Name, err)
			continue
		}

		// Update password in database
		if err := sqlitex.DB.Model(&User{}).Where("id = ?", user.Id).Update("password", hashedPassword).Error; err != nil {
			logger.Errorf("failed to update password for user %s: %v", user.Name, err)
			continue
		}

		logger.Infof("successfully migrated password for user %s", user.Name)
	}

	return nil
}
