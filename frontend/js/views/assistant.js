// AI assistant view (RF04 / RF05): asks the RAG assistant for a solution to an incident and shows the
// answer with its sources. Uses GET /api/incidents and POST /api/incidents/{id}/assistance.
// The frontend only talks to Spring Boot; n8n, Qdrant and OpenRouter are never called from here.
import { api } from '../api.js';
import { showMessage, showError, clearMessage } from '../ui/messages.js';
import { showFieldErrors, clearFieldErrors } from '../ui/forms.js';
import { renderTable } from '../ui/table.js';
import { badge, queryStatusLabel, statusLabel, formatDate } from '../ui/format.js';

// Static markup only (no API data), so innerHTML is safe here. Field names match AssistanceRequest.
const FORM_HTML = `
    <h3>Consultar al asistente</h3>
    <p class="muted">Elige un incidente y describe el problema. El asistente responde solo con artículos
    activos y verificados de la base de conocimiento; si ninguno es suficientemente parecido, no inventa una solución.</p>
    <form class="form-grid" novalidate>
        <div class="field field-wide">
            <label for="assistant-incident">Incidente</label>
            <select id="assistant-incident" name="incidentId" required></select>
        </div>
        <div class="field field-wide">
            <label for="assistant-description">Descripción del problema</label>
            <textarea id="assistant-description" name="description" maxlength="5000" required></textarea>
        </div>
        <div class="form-actions field-wide">
            <button type="submit" class="btn">Consultar asistente</button>
        </div>
    </form>`;

const NO_RESULTS_TEXT = 'No se encontró información suficiente en la base de conocimiento para este problema. '
    + 'El asistente no genera soluciones sin fuentes verificadas: escala el incidente a soporte.';
const ERROR_TEXT = 'El servicio de IA no pudo responder en este momento. La consulta quedó registrada; '
    + 'intenta de nuevo en unos minutos.';

/** Called once, the first time the view is opened. */
export async function init(section) {
    const messages = document.createElement('div');
    messages.className = 'messages';

    const formCard = document.createElement('div');
    formCard.className = 'card';
    formCard.innerHTML = FORM_HTML;

    const resultCard = document.createElement('div');
    resultCard.className = 'card assistant-result';
    resultCard.hidden = true;

    section.append(messages, formCard, resultCard);

    const form = formCard.querySelector('form');
    const incidentSelect = form.elements.namedItem('incidentId');
    const incidents = new Map();

    incidentSelect.addEventListener('change', () => {
        // Start from the incident's own description; the user can refine it before asking
        const incident = incidents.get(Number(incidentSelect.value));
        form.elements.namedItem('description').value = incident?.description ?? '';
        clearFieldErrors(form);
    });
    form.addEventListener('submit', event => ask(event, form, incidents, messages, resultCard));

    // Incidents may be created in another view: reload the list every time this view is opened
    window.addEventListener('hashchange', () => {
        if (location.hash === `#${section.id}`) loadIncidents(incidentSelect, incidents, messages);
    });
    await loadIncidents(incidentSelect, incidents, messages);
}

async function loadIncidents(select, incidents, messages) {
    const selected = select.value;
    try {
        const list = await api('/incidents');
        incidents.clear();
        list.forEach(incident => incidents.set(incident.id, incident));

        const options = [new Option(list.length ? 'Selecciona un incidente' : 'No hay incidentes registrados', '')];
        list.forEach(incident => options.push(new Option(
            `#${incident.id} · ${incident.title} (${statusLabel(incident.status)})`, incident.id)));
        select.replaceChildren(...options);
        if (incidents.has(Number(selected))) select.value = selected;
    } catch (error) {
        showError(messages, error);
    }
}

async function ask(event, form, incidents, messages, resultCard) {
    event.preventDefault();
    clearMessage(messages);
    clearFieldErrors(form);

    const incidentId = Number(form.elements.namedItem('incidentId').value);
    const description = form.elements.namedItem('description').value.trim();

    // Same rules as the backend, checked first to avoid a useless request
    if (!incidentId) {
        showMessage(messages, 'Selecciona un incidente.', 'error');
        return;
    }
    if (!description) {
        showMessage(messages, 'La descripción es obligatoria.', 'error');
        return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Consultando…';
    showMessage(messages, 'Buscando en la base de conocimiento y generando la respuesta…', 'info', { timeout: 0 });

    try {
        const result = await api(`/incidents/${incidentId}/assistance`, { method: 'POST', body: { description } });
        clearMessage(messages);
        renderResult(resultCard, result, incidents.get(incidentId));
    } catch (error) {
        const unplaced = showFieldErrors(form, error);
        if (unplaced.length) {
            showMessage(messages, unplaced.join(' '), 'error');
        } else {
            showError(messages, error);
        }
    } finally {
        button.disabled = false;
        button.textContent = 'Consultar asistente';
    }
}

/** Builds the result card. All API text is set with textContent, never innerHTML. */
function renderResult(card, result, incident) {
    card.replaceChildren();
    card.hidden = false;

    const header = el('div', 'assistant-header');
    header.append(
        text('h3', null, 'Respuesta del asistente'),
        badge(queryStatusLabel(result.status), `query-${result.status}`),
        text('span', 'muted', `Consulta #${result.queryId} · ${formatDate(result.createdAt)}`));
    card.append(header);
    if (incident) card.append(text('p', 'muted', `Incidente #${incident.id}: ${incident.title}`));

    if (result.status === 'ANSWERED' && result.answer) {
        card.append(text('h4', null, 'Solución sugerida'), text('p', null, result.answer.solution));

        if (result.answer.steps?.length) {
            card.append(text('h4', null, 'Pasos recomendados'));
            const steps = el('ol');
            result.answer.steps.forEach(step => steps.append(text('li', null, step)));
            card.append(steps);
        }

        card.append(text('h4', null, 'Fuentes consultadas'));
        const sources = el('div');
        renderTable(sources, [
            { header: 'Artículo', value: s => `#${s.articleId} · ${s.title}` },
            { header: 'Similitud', value: s => `${(s.similarity * 100).toFixed(1)} %` },
        ], result.sources, { emptyText: 'Sin fuentes.' });
        card.append(sources);
        card.append(confidenceBlock(result.confidence));

        const rate = el('p', 'assistant-footer');
        rate.append('¿Te sirvió? Califica esta respuesta en ');
        const link = text('a', null, 'Historial');
        link.href = '#history';
        rate.append(link, '.');
        card.append(rate);
        return;
    }

    const notice = el('div', 'messages');
    card.append(notice);
    if (result.status === 'NO_RESULTS') {
        showMessage(notice, NO_RESULTS_TEXT, 'info', { timeout: 0 });
        card.append(confidenceBlock(result.confidence));
    } else {
        showMessage(notice, ERROR_TEXT, 'error');
    }
}

// Indicador de confianza calculado en el backend (heuristico, no es una probabilidad)
function confidenceBlock(confidence) {
    const box = el('div', 'assistant-confidence');
    if (!confidence) return box;
    const labels = { ALTO: 'Alto', MEDIO: 'Medio', BAJO: 'Bajo' };
    box.append(text('h4', null, 'Confianza'),
        badge(`${confidence.score}/100 · ${labels[confidence.level] ?? confidence.level}`, `confidence-${confidence.level}`));
    const detail = confidence.sourceCount
        ? `Similitud promedio ${(confidence.averageSimilarity * 100).toFixed(1)} % con ${confidence.sourceCount} fuente(s). Es una medida heurística de respaldo, no una probabilidad.`
        : confidence.message;
    box.append(text('p', 'muted', detail));
    return box;
}

function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = value ?? '';
    return node;
}
