package password

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	// Argon2 parameters
	memory      = 64 * 1024 // 64MB
	iterations  = 3
	parallelism = 2
	saltLength  = 16
	keyLength   = 32
)

// HashPassword hashes a password using Argon2
func HashPassword(password string) (string, error) {
	// Generate random salt
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	// Generate hash using Argon2
	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, keyLength)

	// Encode salt and hash to base64
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)

	// Return formatted string: $argon2id$v=19$m=65536,t=3,p=2$[salt]$[hash]
	return "$argon2id$v=19$m=65536,t=3,p=2$" + b64Salt + "$" + b64Hash, nil
}

// VerifyPassword checks if the provided password matches the stored hash
func VerifyPassword(password, encodedHash string) (bool, error) {
	// Parse the encoded hash string
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}

	// Decode salt
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}

	// Decode hash
	hash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}

	// Calculate hash of the provided password using the same parameters
	computedHash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, keyLength)

	// Compare computed hash with stored hash
	if len(computedHash) != len(hash) {
		return false, nil
	}
	for i := 0; i < len(hash); i++ {
		if computedHash[i] != hash[i] {
			return false, nil
		}
	}
	return true, nil
}
