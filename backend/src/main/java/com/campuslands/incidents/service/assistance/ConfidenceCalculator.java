package com.campuslands.incidents.service.assistance;

import java.util.List;

import com.campuslands.incidents.dto.assistance.ConfidenceIndicator;

/**
 * Formula:
 * relativa = (promedio - umbral) / (1 - umbral)  (entre 0 y 1)
 * cobertura = min(fuentes, 3) / 3
 * score = round(100 * (0.7 * relativa + 0.3 * cobertura))
 * Nivel: Alto >= 70, Medio >= 40, Bajo < 40. Sin fuentes = 0.
 */
public final class ConfidenceCalculator {

    static final int MAX_SOURCES = 3;
    static final String NO_SOURCES = "Respaldo documental insuficiente";

    private ConfidenceCalculator() {
    }

    public static ConfidenceIndicator calculate(List<Double> similarities, double threshold) {
        if (similarities == null || similarities.isEmpty()) {
            return new ConfidenceIndicator(0, "BAJO", 0.0, 0, NO_SOURCES);
        }
        double avg = similarities.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double range = 1 - threshold;
        double relative = range <= 0 ? 0 : Math.max(0, Math.min(1, (avg - threshold) / range));
        double coverage = Math.min(similarities.size(), MAX_SOURCES) / (double) MAX_SOURCES;
        int score = (int) Math.round(100 * (0.7 * relative + 0.3 * coverage));
        return new ConfidenceIndicator(score, level(score), avg, similarities.size(), null);
    }

    static String level(int score) {
        if (score >= 70) {
            return "ALTO";
        }
        return score >= 40 ? "MEDIO" : "BAJO";
    }
}
