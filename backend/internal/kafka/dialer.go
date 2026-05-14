package kafka

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"
	"time"

	"kitchenai-backend/pkg/config"

	kafkago "github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"
)

func newDialer(cfg *config.Config) (*kafkago.Dialer, error) {
	dialer := &kafkago.Dialer{
		Timeout:   15 * time.Second,
		DualStack: true,
	}

	if cfg == nil {
		return dialer, nil
	}

	if cfg.KafkaSASLEnabled {
		switch strings.ToUpper(strings.TrimSpace(cfg.KafkaSASLMechanism)) {
		case "PLAIN":
			dialer.SASLMechanism = plain.Mechanism{
				Username: cfg.KafkaUsername,
				Password: cfg.KafkaPassword,
			}
		default:
			return nil, fmt.Errorf("unsupported KAFKA_SASL_MECHANISM %q", cfg.KafkaSASLMechanism)
		}
	}

	if cfg.KafkaTLSEnabled {
		rootCAs, err := x509.SystemCertPool()
		if err != nil || rootCAs == nil {
			rootCAs = x509.NewCertPool()
		}

		caPEM, err := os.ReadFile(cfg.KafkaCAFile)
		if err != nil {
			return nil, fmt.Errorf("read kafka CA file: %w", err)
		}
		if ok := rootCAs.AppendCertsFromPEM(caPEM); !ok {
			return nil, fmt.Errorf("parse kafka CA file %s", cfg.KafkaCAFile)
		}

		dialer.TLS = &tls.Config{
			RootCAs:    rootCAs,
			MinVersion: tls.VersionTLS12,
		}
	}

	return dialer, nil
}
