package services

import "testing"

func TestParseWhatsAppChatJSON_truncatedGroqReply(t *testing.T) {
	raw := `{"reply":"Got it! I'll add milk (1 pcs) to your shopping list. Shall I go ahead?","actions":[{"intent":"add_to_shopping_list"`
	reply, actions, err := parseWhatsAppChatJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if reply == "" {
		t.Fatal("expected salvaged reply")
	}
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(actions))
	}
	if actions[0].Intent != IntentAddShopping {
		t.Fatalf("intent=%q", actions[0].Intent)
	}
	if actions[0].Entities.ItemName != "milk" {
		t.Fatalf("item_name=%q", actions[0].Entities.ItemName)
	}
}

func TestParseWhatsAppChatJSON_fullPayload(t *testing.T) {
	raw := `{"reply":"Adding milk.","actions":[{"intent":"add_to_shopping_list","confidence":0.9,"summary":"Add milk","entities":{"item_name":"milk","qty":1,"unit":"pcs"}}]}`
	reply, actions, err := parseWhatsAppChatJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if reply != "Adding milk." {
		t.Fatalf("reply=%q", reply)
	}
	if len(actions) != 1 || actions[0].Entities.ItemName != "milk" {
		t.Fatalf("actions=%+v", actions)
	}
}

func TestExtractWhatsAppReplyField(t *testing.T) {
	raw := `{"reply":"Hello there","actions":[`
	got := extractWhatsAppReplyField(raw)
	if got != "Hello there" {
		t.Fatalf("got %q", got)
	}
}
