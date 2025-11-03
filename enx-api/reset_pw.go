//go:build ignore

package main

import (
"crypto/rand"
"encoding/base64"
"fmt"
"golang.org/x/crypto/argon2"
)

func main() {
	password := "haCahpro"
	salt := make([]byte, 16)
	rand.Read(salt)
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	hashed := "$argon2id$v=19$m=65536,t=3,p=2$" + b64Salt + "$" + b64Hash
	fmt.Println("Password:", password)
	fmt.Println("Hash:", hashed)
	fmt.Printf("\nUPDATE users SET password = '%s' WHERE name = 'wiloon';\n", hashed)
}
