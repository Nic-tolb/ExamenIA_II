package com.campuslands.incidents.dto.assistance;

/**
 * Indicador heuristico de respaldo documental (0-100). No es una probabilidad de que la respuesta sea correcta.
 */
public record ConfidenceIndicator(int score, String level, double averageSimilarity, int sourceCount, String message) {
}
