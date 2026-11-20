package com.campuslands.incidents.service.assistance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.campuslands.incidents.dto.assistance.ConfidenceIndicator;

class ConfidenceCalculatorTest {

    private static final double THRESHOLD = 0.60;

    @Test
    void threeHighSimilaritySourcesGiveHighConfidence() {
        ConfidenceIndicator result = ConfidenceCalculator.calculate(List.of(0.90, 0.88, 0.85), THRESHOLD);

        // promedio 0.8767 -> relativa 0.6917 -> 100 * (0.7 * 0.6917 + 0.3 * 1) = 78.4
        assertThat(result.score()).isEqualTo(78);
        assertThat(result.level()).isEqualTo("ALTO");
        assertThat(result.sourceCount()).isEqualTo(3);
    }

    @Test
    void oneSourceNearThresholdGivesLowConfidence() {
        ConfidenceIndicator result = ConfidenceCalculator.calculate(List.of(0.61), THRESHOLD);

        // relativa 0.025 -> 100 * (0.7 * 0.025 + 0.3 * 1/3) = 11.75
        assertThat(result.score()).isEqualTo(12);
        assertThat(result.level()).isEqualTo("BAJO");
    }

    @Test
    void formulaIsCalculatedCorrectly() {
        ConfidenceIndicator result = ConfidenceCalculator.calculate(List.of(0.80, 0.70), THRESHOLD);

        // promedio 0.75 -> relativa 0.375 -> 100 * (0.2625 + 0.2) = 46.25
        assertThat(result.averageSimilarity()).isCloseTo(0.75, within(1e-9));
        assertThat(result.score()).isEqualTo(46);
        assertThat(result.level()).isEqualTo("MEDIO");
    }

    @Test
    void noSourcesGiveZeroAndInsufficientMessage() {
        ConfidenceIndicator result = ConfidenceCalculator.calculate(List.of(), THRESHOLD);

        assertThat(result.score()).isZero();
        assertThat(result.level()).isEqualTo("BAJO");
        assertThat(result.sourceCount()).isZero();
        assertThat(result.message()).isEqualTo("Respaldo documental insuficiente");
    }
}
