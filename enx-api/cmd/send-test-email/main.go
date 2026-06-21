package main

import (
	"flag"
	"fmt"
	"log"

	"enx-api/email"
	"enx-api/utils"

	"github.com/spf13/viper"
)

func main() {
	var to, kind string
	flag.StringVar(&to, "to", "", "Recipient email address (required)")
	flag.StringVar(&kind, "kind", "verification", "Email type: 'verification' or 'reset'")
	flag.Parse()

	if to == "" {
		log.Fatal("Usage: send-test-email -to=you@example.com [-kind=verification|reset]")
	}

	utils.ViperInit()

	apiKey := viper.GetString("resend.api-key")
	if apiKey == "" {
		log.Fatal("RESEND_API_KEY is not set -- check your .env file")
	}

	keyPreview := apiKey
	if len(keyPreview) > 8 {
		keyPreview = apiKey[:8]
	}
	fmt.Printf("Resend API key: %s...\n", keyPreview)
	fmt.Printf("From: %s\n", viper.GetString("resend.from"))
	fmt.Printf("Frontend base URL: %s\n", viper.GetString("app.frontend-base-url"))
	fmt.Printf("Sending %s email to %s ...\n", kind, to)

	var err error
	switch kind {
	case "verification":
		err = email.SendVerificationEmail(to, "testuser", "fake-token-abc123")
	case "reset":
		err = email.SendPasswordResetEmail(to, "testuser", "fake-reset-token-xyz789")
	default:
		log.Fatalf("Unknown kind %q -- use 'verification' or 'reset'", kind)
	}

	if err != nil {
		log.Fatalf("Failed to send email: %v", err)
	}
	fmt.Println("Email sent successfully!")
}
