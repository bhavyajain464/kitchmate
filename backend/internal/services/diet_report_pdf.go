package services

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/jung-kurt/gofpdf"
	"github.com/wcharczuk/go-chart/v2"
	"github.com/wcharczuk/go-chart/v2/drawing"
)

const (
	pdfMarginL  = 16.0
	pdfMarginT  = 14.0
	pdfMarginR  = 16.0
	pdfContentW = 210.0 - pdfMarginL - pdfMarginR // A4 width mm
)

// BuildDietReportPDF renders the nutrition report with charts as a PDF byte slice.
func BuildDietReportPDF(report *DietDayReport) ([]byte, error) {
	if report == nil {
		return nil, fmt.Errorf("report is nil")
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(pdfMarginL, pdfMarginT, pdfMarginR)
	pdf.SetAutoPageBreak(true, 18)
	pdf.AddPage()

	drawReportHeader(pdf, report)
	drawSummaryBox(pdf, report)
	drawTotalsTable(pdf, report.Totals)
	drawMacroCharts(pdf, report)
	drawMealCaloriesChart(pdf, report.Meals)
	drawMealsTable(pdf, report.Meals)
	drawMicronutrientsTable(pdf, report.Micronutrients)
	drawBulletSection(pdf, "Highlights", report.Highlights)
	drawBulletSection(pdf, "Suggestions for tomorrow", report.Suggestions)
	drawDisclaimer(pdf, report.Disclaimer)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func drawReportHeader(pdf *gofpdf.Fpdf, report *DietDayReport) {
	pdf.SetFillColor(46, 125, 50)
	pdf.Rect(pdfMarginL, pdfMarginT, pdfContentW, 22, "F")
	pdf.SetTextColor(255, 255, 255)
	pdf.SetXY(pdfMarginL+4, pdfMarginT+5)
	pdf.SetFont("Helvetica", "B", 16)
	title := "Rasoibuddy - Daily Diet Report"
	if strings.Contains(report.Date, " to ") {
		title = "Rasoibuddy - Weekly Diet Report"
	}
	pdf.CellFormat(pdfContentW-8, 7, pdfASCII(title), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 10)
	pdf.CellFormat(pdfContentW-8, 5, pdfASCII(report.Date), "", 1, "L", false, 0, "")
	pdf.SetXY(pdfMarginL, pdfMarginT+26)
	if report.BalanceScore > 0 {
		pdf.SetFillColor(243, 229, 245)
		pdf.SetTextColor(106, 27, 154)
		pdf.SetFont("Helvetica", "B", 11)
		pdf.CellFormat(pdfContentW, 8, pdfASCII(fmt.Sprintf("Balance score: %d / 100", report.BalanceScore)), "", 1, "C", true, 0, "")
		pdf.Ln(2)
	}
}

func drawSummaryBox(pdf *gofpdf.Fpdf, report *DietDayReport) {
	if strings.TrimSpace(report.Summary) == "" {
		return
	}
	pdf.SetFillColor(248, 249, 250)
	pdf.SetDrawColor(220, 220, 220)
	pdf.SetTextColor(50, 50, 50)
	pdf.SetFont("Helvetica", "", 10)
	y := pdf.GetY()
	pdf.MultiCell(pdfContentW, 5, pdfASCII(report.Summary), "1", "L", true)
	if pdf.GetY()-y < 12 {
		pdf.Ln(12 - (pdf.GetY() - y))
	}
	pdf.Ln(4)
}

func drawTotalsTable(pdf *gofpdf.Fpdf, t DietMacroTotals) {
	sectionTitle(pdf, "Daily totals")
	colW := pdfContentW / 3
	rowH := 7.0
	headers := []string{"Calories", "Protein", "Carbs"}
	vals := []string{
		fmt.Sprintf("%.0f kcal", t.CaloriesKcal),
		fmt.Sprintf("%.1f g", t.ProteinG),
		fmt.Sprintf("%.1f g", t.CarbsG),
	}
	drawTableRow(pdf, headers, vals, colW, rowH, true)
	headers2 := []string{"Fat", "Fiber", "Sugar"}
	vals2 := []string{
		fmt.Sprintf("%.1f g", t.FatG),
		fmt.Sprintf("%.1f g", t.FiberG),
		fmt.Sprintf("%.1f g", t.SugarG),
	}
	drawTableRow(pdf, headers2, vals2, colW, rowH, true)
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(80, 80, 80)
	pdf.CellFormat(pdfContentW, 6, pdfASCII(fmt.Sprintf("Sodium: %.0f mg", t.SodiumMg)), "", 1, "L", false, 0, "")
	pdf.Ln(5)
}

func drawMacroCharts(pdf *gofpdf.Fpdf, report *DietDayReport) {
	sectionTitle(pdf, "Macronutrients")
	y := pdf.GetY()
	chartW := pdfContentW
	halfW := (chartW - 4) / 2

	if pngPie, err := renderMacroPiePNG(report.MacroSplitPct); err == nil {
		opt := gofpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
		pdf.RegisterImageOptionsReader("macroPie", opt, pngPie)
		pdf.ImageOptions("macroPie", pdfMarginL, y, halfW, 0, false, opt, 0, "")
	}
	if pngBars, err := renderMacroBarPNG(report.Totals); err == nil {
		opt := gofpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
		pdf.RegisterImageOptionsReader("macroBars", opt, pngBars)
		pdf.ImageOptions("macroBars", pdfMarginL+halfW+4, y, halfW, 0, false, opt, 0, "")
	}
	pdf.SetY(y + 72)
	pdf.Ln(4)
}

func drawMealCaloriesChart(pdf *gofpdf.Fpdf, meals []DietMealBreakdown) {
	if len(meals) == 0 {
		return
	}
	sectionTitle(pdf, "Calories by meal")
	y := pdf.GetY()
	if pngMeals, err := renderMealCaloriesPNG(meals); err == nil {
		opt := gofpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
		pdf.RegisterImageOptionsReader("mealCals", opt, pngMeals)
		pdf.ImageOptions("mealCals", pdfMarginL, y, pdfContentW, 0, false, opt, 0, "")
		pdf.SetY(y + 58)
	}
	pdf.Ln(4)
}

func drawMealsTable(pdf *gofpdf.Fpdf, meals []DietMealBreakdown) {
	if len(meals) == 0 {
		return
	}
	sectionTitle(pdf, "Per-meal breakdown")
	cols := []float64{55, 25, 25, 24, 24, 25}
	headers := []string{"Meal", "Slot", "kcal", "Protein", "Carbs", "Fat"}
	drawTableRowCustom(pdf, headers, cols, 7, true)
	for _, m := range meals {
		slot := m.Slot
		if slot == "" {
			slot = "-"
		}
		vals := []string{
			pdfASCII(m.Name),
			pdfASCII(slot),
			fmt.Sprintf("%.0f", m.CaloriesKcal),
			fmt.Sprintf("%.1f g", m.ProteinG),
			fmt.Sprintf("%.1f g", m.CarbsG),
			fmt.Sprintf("%.1f g", m.FatG),
		}
		drawTableRowCustom(pdf, vals, cols, 6.5, false)
	}
	pdf.Ln(4)
}

func drawMicronutrientsTable(pdf *gofpdf.Fpdf, micros []DietMicronutrient) {
	if len(micros) == 0 {
		return
	}
	sectionTitle(pdf, "Micronutrients")
	cols := []float64{38, 28, 22, pdfContentW - 88}
	headers := []string{"Nutrient", "Amount", "Status", "Note"}
	drawTableRowCustom(pdf, headers, cols, 7, true)
	pdf.SetFont("Helvetica", "", 8.5)
	for _, m := range micros {
		note := m.Note
		if len(note) > 60 {
			note = note[:57] + "..."
		}
		drawTableRowCustom(pdf, []string{
			pdfASCII(m.Name),
			pdfASCII(m.Amount),
			pdfASCII(m.Status),
			pdfASCII(note),
		}, cols, 6, false)
	}
	pdf.Ln(4)
}

func drawBulletSection(pdf *gofpdf.Fpdf, title string, items []string) {
	if len(items) == 0 {
		return
	}
	if pdf.GetY() > 250 {
		pdf.AddPage()
	}
	sectionTitle(pdf, title)
	pdf.SetFont("Helvetica", "", 9.5)
	pdf.SetTextColor(40, 40, 40)
	for _, item := range items {
		pdf.MultiCell(pdfContentW, 5, pdfASCII("- "+item), "", "L", false)
		pdf.Ln(1)
	}
	pdf.Ln(3)
}

func drawDisclaimer(pdf *gofpdf.Fpdf, text string) {
	if text == "" {
		text = "Estimates from meal names and typical portions. Not medical advice."
	}
	pdf.SetFont("Helvetica", "I", 8)
	pdf.SetTextColor(130, 130, 130)
	pdf.MultiCell(pdfContentW, 4, pdfASCII(text), "", "L", false)
}

func sectionTitle(pdf *gofpdf.Fpdf, title string) {
	pdf.SetFont("Helvetica", "B", 12)
	pdf.SetTextColor(46, 125, 50)
	pdf.CellFormat(pdfContentW, 8, pdfASCII(title), "", 1, "L", false, 0, "")
	pdf.SetDrawColor(46, 125, 50)
	pdf.Line(pdfMarginL, pdf.GetY(), pdfMarginL+pdfContentW, pdf.GetY())
	pdf.Ln(3)
}

func drawTableRow(pdf *gofpdf.Fpdf, headers, vals []string, colW, rowH float64, header bool) {
	n := len(headers)
	if n == 0 {
		return
	}
	if colW <= 0 {
		colW = pdfContentW / float64(n)
	}
	if header {
		pdf.SetFillColor(232, 245, 233)
		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetTextColor(27, 94, 32)
		for _, h := range headers {
			pdf.CellFormat(colW, rowH, pdfASCII(h), "1", 0, "C", true, 0, "")
		}
		pdf.Ln(-1)
	}
	if len(vals) > 0 {
		pdf.SetFillColor(255, 255, 255)
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetTextColor(40, 40, 40)
		for _, v := range vals {
			pdf.CellFormat(colW, rowH, pdfASCII(v), "1", 0, "C", true, 0, "")
		}
		pdf.Ln(-1)
	}
}

func drawTableRowCustom(pdf *gofpdf.Fpdf, vals []string, colWidths []float64, rowH float64, header bool) {
	if header {
		pdf.SetFillColor(232, 245, 233)
		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetTextColor(27, 94, 32)
	} else {
		pdf.SetFillColor(255, 255, 255)
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetTextColor(40, 40, 40)
	}
	for i, v := range vals {
		w := colWidths[i]
		align := "L"
		if i > 0 && !header {
			align = "C"
		}
		if header {
			align = "C"
		}
		pdf.CellFormat(w, rowH, v, "1", 0, align, true, 0, "")
	}
	pdf.Ln(-1)
}

// pdfASCII normalizes text for core PDF fonts (Helvetica = Latin-1 only).
func pdfASCII(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	repl := strings.NewReplacer(
		"\u2014", "-", "\u2013", "-", "\u2212", "-",
		"\u2022", "-", "\u2023", "-", "\u00b7", "-",
		"\u2018", "'", "\u2019", "'", "\u201c", `"`, "\u201d", `"`,
		"\u2026", "...", "\u2192", "->",
		"\u00a0", " ",
	)
	s = repl.Replace(s)
	var b strings.Builder
	for _, r := range s {
		if r == '\n' || r == '\t' || (r >= 32 && r <= 126) {
			b.WriteRune(r)
		} else if r > 126 && r < 256 {
			b.WriteRune(r) // Latin-1 supplement
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.TrimSpace(b.String())
}

func renderMacroPiePNG(split DietMacroSplit) (*bytes.Reader, error) {
	p, c, f := split.Protein, split.Carbs, split.Fat
	if p+c+f < 1 {
		return nil, fmt.Errorf("empty macro split")
	}
	pie := chart.PieChart{
		Title:  "Macro split (energy %)",
		Width:  480,
		Height: 400,
		Values: []chart.Value{
			{Value: p, Label: fmt.Sprintf("Protein %.0f%%", p), Style: chart.Style{FillColor: drawing.Color{R: 76, G: 175, B: 80, A: 255}}},
			{Value: c, Label: fmt.Sprintf("Carbs %.0f%%", c), Style: chart.Style{FillColor: drawing.Color{R: 33, G: 150, B: 243, A: 255}}},
			{Value: f, Label: fmt.Sprintf("Fat %.0f%%", f), Style: chart.Style{FillColor: drawing.Color{R: 255, G: 152, B: 0, A: 255}}},
		},
	}
	return renderChartPNG(pie.Render)
}

func renderMacroBarPNG(t DietMacroTotals) (*bytes.Reader, error) {
	maxG := t.CarbsG
	if t.ProteinG > maxG {
		maxG = t.ProteinG
	}
	if t.FatG > maxG {
		maxG = t.FatG
	}
	if t.FiberG > maxG {
		maxG = t.FiberG
	}
	if maxG < 1 {
		maxG = 100
	}
	bar := chart.BarChart{
		Title:  "Macros (grams)",
		Width:  480,
		Height: 360,
		Background: chart.Style{
			Padding: chart.Box{Top: 40, Left: 25, Right: 15, Bottom: 25},
		},
		YAxis: chart.YAxis{Name: "grams", Style: chart.Style{FontSize: 9}},
		Bars: []chart.Value{
			{Value: t.ProteinG, Label: "Protein", Style: chart.Style{FillColor: drawing.Color{R: 76, G: 175, B: 80, A: 255}}},
			{Value: t.CarbsG, Label: "Carbs", Style: chart.Style{FillColor: drawing.Color{R: 33, G: 150, B: 243, A: 255}}},
			{Value: t.FatG, Label: "Fat", Style: chart.Style{FillColor: drawing.Color{R: 255, G: 152, B: 0, A: 255}}},
			{Value: t.FiberG, Label: "Fiber", Style: chart.Style{FillColor: drawing.Color{R: 156, G: 39, B: 176, A: 255}}},
		},
	}
	return renderChartPNG(bar.Render)
}

func renderMealCaloriesPNG(meals []DietMealBreakdown) (*bytes.Reader, error) {
	if len(meals) == 0 {
		return nil, fmt.Errorf("no meals")
	}
	vals := make([]chart.Value, 0, len(meals))
	for _, m := range meals {
		label := m.Name
		if len(label) > 16 {
			label = label[:16] + "..."
		}
		if m.Slot != "" {
			label = label + " (" + m.Slot + ")"
		}
		vals = append(vals, chart.Value{
			Value: m.CaloriesKcal,
			Label: label,
			Style: chart.Style{FillColor: drawing.Color{R: 106, G: 27, B: 154, A: 255}},
		})
	}
	bar := chart.BarChart{
		Title:  "Calories per logged meal",
		Width:  700,
		Height: 300,
		Background: chart.Style{
			Padding: chart.Box{Top: 45, Left: 30, Right: 20, Bottom: 35},
		},
		YAxis: chart.YAxis{Name: "kcal", Style: chart.Style{FontSize: 9}},
		Bars:  vals,
	}
	return renderChartPNG(bar.Render)
}

func renderChartPNG(render func(chart.RendererProvider, io.Writer) error) (*bytes.Reader, error) {
	buf := bytes.NewBuffer(nil)
	if err := render(chart.PNG, buf); err != nil {
		return nil, err
	}
	return bytes.NewReader(buf.Bytes()), nil
}
