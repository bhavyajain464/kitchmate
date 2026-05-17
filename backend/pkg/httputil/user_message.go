package httputil

import "strings"

const genericUserMessage = "Something went wrong. Please try again in a moment."

// UserFacingMessage maps internal/LLM errors to a safe client message.
func UserFacingMessage(err error) string {
	if err == nil {
		return genericUserMessage
	}
	return UserFacingMessageFromString(err.Error())
}

// UserFacingMessageFromString returns msg unless it looks like an internal error.
func UserFacingMessageFromString(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return genericUserMessage
	}
	if isInternalErrorString(strings.ToLower(msg)) || len(msg) > 160 {
		return genericUserMessage
	}
	return msg
}

func isInternalErrorString(lower string) bool {
	needles := []string{
		"groq", "gemini", "openai", "rate limit", "whatsapp parse",
		"organization `org_", "tokens per day", "tokens per minute",
		"service tier", "llama-", "http 5", "internal server",
		"invalid json", "empty response",
	}
	for _, n := range needles {
		if strings.Contains(lower, n) {
			return true
		}
	}
	return false
}
