# Indicador de confianza

Se calcula en el backend (`ConfidenceCalculator`), no lo genera la IA.

```
relativa  = (promedio_similitud - umbral) / (1 - umbral)   // entre 0 y 1
cobertura = min(fuentes, 3) / 3
indice    = round(100 * (0.7 * relativa + 0.3 * cobertura))
```

- Alto: 70-100, Medio: 40-69, Bajo: 0-39
- Sin fuentes: 0, "Respaldo documental insuficiente"

Ejemplo (umbral 0.60): fuentes 0.80 y 0.70 → promedio 0.75, relativa 0.375 → 100 * (0.2625 + 0.2) = 46 (Medio).

Es una medida heurística del respaldo documental, no la probabilidad de que la solución sea correcta.
