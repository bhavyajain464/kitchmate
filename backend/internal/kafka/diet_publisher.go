package kafka

// DietAnalysisPublisherAdapter lets CookedLogService publish without importing kafka types circularly.
type DietAnalysisPublisherAdapter struct {
	Producer *Producer
}

func (a DietAnalysisPublisherAdapter) PublishDietAnalysis(cookedLogID, userID string) {
	if a.Producer == nil {
		return
	}
	a.Producer.PublishDietAnalysisEvent(DietAnalysisEvent{
		CookedLogID: cookedLogID,
		UserID:      userID,
	})
}
