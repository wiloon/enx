package account

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// EmailHMAC keys the trial grant record (ADR-062 Decision 3): HMAC-SHA256 of
// the trimmed, lower-cased email under a server-side key. Plain SHA-256 is
// not enough: emails are few enough to be guessed from a dictionary.
type EmailHMAC struct {
	key []byte
}

func NewEmailHMAC(key string) EmailHMAC { return EmailHMAC{key: []byte(key)} }

// Configured reports whether a key is set.
func (h EmailHMAC) Configured() bool { return len(h.key) > 0 }

// Of returns the hex HMAC of email; "" when the email is blank or no key is
// set, which the trial grant treats as "cannot check, do not grant".
func (h EmailHMAC) Of(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !h.Configured() {
		return ""
	}
	mac := hmac.New(sha256.New, h.key)
	mac.Write([]byte(email))
	return hex.EncodeToString(mac.Sum(nil))
}
