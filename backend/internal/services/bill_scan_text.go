package services

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"kitchenai-backend/pkg/config"
)

// trimInvoiceTextForLLM drops boilerplate sections before the LLM call (GST annexures, footers, etc.).
func trimInvoiceTextForLLM(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return text
	}
	// Swiggy / Blinkit tax annexures and footers add noise without item rows.
	cutMarkers := []string{
		"\nANNEXURE",
		"\nAnnexure",
		"\nAmount in words:",
		"\nAmount in Words:",
		"\nAMOUNT IN WORDS:",
		"\nInvoice Amount (in words)",
		"\nPAYMENT QR",
		"\nPayment QR",
		"\nTerms and Conditions",
		"\nDisclaimer:",
		"\nDISCLAIMER:",
	}
	for _, m := range cutMarkers {
		if idx := strings.Index(text, m); idx > 0 {
			text = strings.TrimSpace(text[:idx])
		}
	}
	// Collapse excessive blank lines.
	text = regexp.MustCompile(`\n{3,}`).ReplaceAllString(text, "\n\n")
	// Cap length — item tables rarely exceed this; protects against huge scans.
	const maxRunes = 6000
	if len(text) > maxRunes {
		text = text[:maxRunes]
	}
	return strings.TrimSpace(text)
}

func scanBillGroqFromInvoiceText(ctx context.Context, cfg *config.Config, invoiceText string) ([]BillItem, error) {
	if !cfg.HasGroqAPIKey() {
		return nil, fmt.Errorf("groq API key not configured")
	}
	text := trimInvoiceTextForLLM(invoiceText)
	if text == "" {
		return nil, fmt.Errorf("no bill text to parse")
	}
	prompt := billScanCompactTextPrompt + "\n\n---\n" + text
	model := cfg.EffectiveGroqModel()
	out, err := groqChatBillExtract(ctx, cfg.PickGroqAPIKey(), model, groqMaxTokensBillScan, []groqMessage{
		{Role: "user", Content: prompt},
	})
	if err != nil {
		return nil, fmt.Errorf("groq bill scan: %w", err)
	}
	return ParseBillItems(out)
}
