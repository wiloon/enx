package main

import (
	"flag"
	"fmt"
	"log"

	"enx-api/utils/password"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type User struct {
	ID       string `gorm:"column:id;primaryKey"`
	Name     string `gorm:"column:name"`
	Password string `gorm:"column:password"`
}

func (User) TableName() string {
	return "users"
}

func main() {
	// Command line flags
	var username, newPassword string
	flag.StringVar(&username, "username", "", "Username to reset password for")
	flag.StringVar(&newPassword, "password", "", "New password")
	flag.Parse()

	if username == "" || newPassword == "" {
		log.Fatal("Usage: reset-password -username=<username> -password=<password>")
	}

	// Database path
	dbPath := "/var/lib/enx-api/enx.db"

	// Open SQLite database
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Generate new password hash
	newPasswordHash, err := password.HashPassword(newPassword)
	if err != nil {
		log.Fatalf("Failed to hash password: %v", err)
	}

	// First, check if user exists
	var user User
	result := db.Where("name = ?", username).First(&user)
	if result.Error != nil {
		log.Fatalf("User not found: %v", result.Error)
	}

	fmt.Printf("Found user: %s (ID: %s)\n", user.Name, user.ID)
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
