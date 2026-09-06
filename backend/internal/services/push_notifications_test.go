package services

import "testing"

func TestIsValidExpoPushToken(t *testing.T) {
	if !isValidExpoPushToken("ExponentPushToken[abc123]") {
		t.Fatal("expected ExponentPushToken valid")
	}
	if !isValidExpoPushToken("ExpoPushToken[xyz]") {
		t.Fatal("expected ExpoPushToken valid")
	}
	if isValidExpoPushToken("invalid") {
		t.Fatal("expected invalid token rejected")
	}
}
