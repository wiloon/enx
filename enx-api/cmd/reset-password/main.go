package main

import (
	"fmt"
	"log"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type User struct {
	ID       int    `gorm:"column:id;primaryKey"`
	Name     string `gorm:"column:name"`
	Password string `gorm:"column:password"`
}

func (User) TableName() string {
	return "users"
}

func main() {
	// Database path
	dbPath := "/var/lib/enx-api/enx.db"

	// Open SQLite database
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// New password hash (already generated using Argon2id)
	newPasswordHash := "$argon2id$v=19$m=65536,t=3,p=2$/zKJEMaCyzu7tTgbec3L2g$RIORjmDO9ZLl+qsTpOxx5KbRnwo+7uRJbTxnDt6Z5Hg"
	username := "wiloon"

	// First, check if user exists
	var user User
	result := db.Where("name = ?", username).First(&user)
	if result.Error != nil {
		log.Fatalf("User not found: %v", result.Error)
	}

	fmt.Printf("Found user: %s (ID: %d)\n", user.Name, user.ID)
	fmt.Printf("Current password hash: %s\n", user.Password)

	// Update password
	result = db.Model(&User{}).Where("name = ?", username).Update("password", newPasswordHash)
	if result.Error != nil {
		log.Fatalf("Failed to update password: %v", result.Error)
	}

	fmt.Printf("✓ Password updated successfully! Rows affected: %d\n", result.RowsAffected)

	// Verify update
	var updatedUser User
	db.Where("name = ?", username).First(&updatedUser)
	fmt.Printf("New password hash: %s\n", updatedUser.Password)
}
