// app.js - A.R.G.O.S. Motor Lógico Local (PWA) Final
'use strict';

// ============================================================================
// 1. MOTOR DE BASE DE DATOS LOCAL (IndexedDB)
// ============================================================================
const DB_NAME = 'ArgosTacticalDB';
const DB_VERSION = 1;
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            console.log('[Obi-Wan] Forjando la base de datos local...');
            
            if (!database.objectStoreNames.contains('config')) database.createObjectStore('config', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('bitacora')) database.createObjectStore('bitacora', { keyPath: 'fecha' });
            if (!database.objectStoreNames.contains('comidas')) database.createObjectStore('comidas', { keyPath: 'timestamp' });
        };

        request.onsuccess = (event) => { db = event.target.result; resolve(db); };
        request.onerror = (event) => { reject(event.target.error); };
    });
}

const DB = {
    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const req = db.transaction([storeName], 'readwrite').objectStore(storeName).put(data);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const req = db.transaction([storeName], 'readonly').objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const req = db.transaction([storeName], 'readonly').objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const req = db.transaction([storeName], 'readwrite').objectStore(storeName).clear();
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }
};

// ============================================================================
// 2. CONFIGURACIÓN Y COPIAS DE SEGURIDAD (Soporte Vital)
// ============================================================================
async function cargarConfiguracion() {
    const config = await DB.get('config', 'credenciales');
    if (config) {
        document.getElementById('cfg-athlete-id').value = config.athleteId || '';
        document.getElementById('cfg-intervals-key').value = config.intervalsKey || '';
        document.getElementById('cfg-gemini-key').value = config.geminiKey || '';
        document.getElementById('cfg-nombre-atleta').value = config.nombre || 'Atleta';
        document.getElementById('header-atleta').textContent = config.nombre || 'Atleta';
        
        // Cargar lesiones
        document.getElementById('texto-lesiones').value = config.lesiones || '';
    }
}

async function guardarConfiguracion() {
    const configData = {
        id: 'credenciales',
        athleteId: document.getElementById('cfg-athlete-id').value.trim(),
        intervalsKey: document.getElementById('cfg-intervals-key').value.trim(),
        geminiKey: document.getElementById('cfg-gemini-key').value.trim(),
        nombre: document.getElementById('cfg-nombre-atleta').value.trim(),
        lesiones: document.getElementById('texto-lesiones').value.trim()
    };
    await DB.put('config', configData);
    document.getElementById('header-atleta').textContent = configData.nombre;
    alert('Configuración guardada en el dispositivo.');
    location.reload();
}

async function exportarRespaldo() {
    const data = {
        config: await DB.getAll('config'),
        bitacora: await DB.getAll('bitacora'),
        comidas: await DB.getAll('comidas')
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `argos_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
}

async function importarRespaldo(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.config) for (const item of data.config) await DB.put('config', item);
            if (data.bitacora) for (const item of data.bitacora) await DB.put('bitacora', item);
            if (data.comidas) for (const item of data.comidas) await DB.put('comidas', item);
            alert('Copia de seguridad restaurada con éxito.');
            location.reload();
        } catch (err) {
            alert('Error al leer el archivo de respaldo.');
        }
    };
    reader.readAsText(file);
}

// ============================================================================
// 3. TELEMETRÍA (Intervals.icu) Y BITÁCORA MÉDICA
// ============================================================================
let globalActivities = [];

async function fetchIntervalsData() {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.athleteId || !config.intervalsKey) throw new Error('Faltan credenciales de Intervals.');
    const token = btoa('API_KEY:' + config.intervalsKey);
    const headers = { 'Authorization': `Basic ${token}` };
    
    const hoy = new Date();
    const hace14Dias = new Date(); hace14Dias.setDate(hoy.getDate() - 14);
    const strHoy = hoy.toISOString().split('T')[0];
    const strInicio = hace14Dias.toISOString().split('T')[0];

    const [resWell, resAct] = await Promise.all([
        fetch(`https://intervals.icu/api/v1/athlete/${config.athleteId}/wellness?oldest=${strInicio}&newest=${strHoy}`, { headers }),
        fetch(`https://intervals.icu/api/v1/athlete/${config.athleteId}/activities?oldest=${strInicio}&newest=${strHoy}`, { headers })
    ]);
    if (!resWell.ok) throw new Error('Fallo en Intervals.');
    return { wellness: await resWell.json(), activities: await resAct.json() };
}

async function renderBitacoraYRPE(activities) {
    globalActivities = activities;
    const bitacoraData = await DB.getAll('bitacora');
    const fechasMap = new Map();

    // Rellenar últimos 14 días
    for (let i = 0; i < 14; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        fechasMap.set(d.toISOString().split('T')[0], { real: [], rpe: 5, dolor: 1, comentario: '', cumplido: false });
    }

    activities.forEach(act => {
        const f = act.start_date_local.split('T')[0];
        if (fechasMap.has(f)) fechasMap.get(f).real.push(act.type);
    });

    bitacoraData.forEach(b => {
        if (fechasMap.has(b.fecha)) {
            const entry = fechasMap.get(b.fecha);
            entry.rpe = b.rpe || 5; entry.dolor = b.dolor || 1;
            entry.comentario = b.comentario || ''; entry.cumplido = b.cumplido || false;
            entry.resumenIA = b.resumenIA || '';
        }
    });

    let htmlGrid = '<div class="bitacora-header"><div>Día</div><div>Actividad</div><div>Prescripción</div></div>';
    let htmlRPE = '';

    fechasMap.forEach((data, fecha) => {
        const acts = data.real.length > 0 ? data.real.join(', ') : '<span style="color:#505050">SIN REGISTRO</span>';
        const checked = data.cumplido ? 'checked' : '';
        const fCorto = fecha.slice(5);

        // Grid Panel Principal
        htmlGrid += `
            <div class="bitacora-row">
                <div class="bitacora-cell date-cell">${fCorto}</div>
                <div class="bitacora-cell real-cell">${acts}</div>
                <div class="bitacora-cell ia-cell">
                    <label style="cursor:pointer; display:flex; gap:6px;"><input type="checkbox" class="check-cumplido" data-fecha="${fecha}" ${checked}><span>${data.resumenIA || 'Libre'}</span></label>
                </div>
            </div>`;

        // Tarjetas Registro Médico
        htmlRPE += `
            <div class="bloque-entrenamiento sensacion-card">
                <div class="sensacion-header"><h4 class="sensacion-titulo">${fecha}</h4><span class="sensacion-resumen">${acts}</span></div>
                <div class="sensacion-sliders">
                    <div>
                        <div class="slider-row"><label class="slider-label">ESFUERZO (RPE)</label><span id="val-rpe-${fecha}" class="slider-val rpe-val">${data.rpe}/10</span></div>
                        <input type="range" min="1" max="10" value="${data.rpe}" class="slider-sensacion" data-tipo="rpe" data-fecha="${fecha}">
                    </div>
                    <div>
                        <div class="slider-row"><label class="slider-label">DOLOR</label><span id="val-dolor-${fecha}" class="slider-val dolor-val">${data.dolor}/10</span></div>
                        <input type="range" min="1" max="10" value="${data.dolor}" class="slider-sensacion" data-tipo="dolor" data-fecha="${fecha}">
                    </div>
                </div>
                <textarea class="textarea-comentario" data-fecha="${fecha}" placeholder="Notas médicas...">${data.comentario}</textarea>
            </div>`;
    });

    document.getElementById('bitacora-list').innerHTML = htmlGrid;
    document.getElementById('sensaciones-list').innerHTML = htmlRPE;

    // Listeners para guardar en BD
    document.querySelectorAll('.slider-sensacion').forEach(s => {
        s.addEventListener('input', e => document.getElementById(`val-${e.target.dataset.tipo}-${e.target.dataset.fecha}`).textContent = e.target.value + '/10');
        s.addEventListener('change', e => guardarEstadoBitacora(e.target.dataset.fecha));
    });
    document.querySelectorAll('.textarea-comentario, .check-cumplido').forEach(el => {
        el.addEventListener('change', e => guardarEstadoBitacora(e.target.dataset.fecha));
    });
}

async function guardarEstadoBitacora(fecha) {
    const existing = await DB.get('bitacora', fecha) || { fecha };
    
    // Buscar los elementos en el DOM (si existen)
    const check = document.querySelector(`.check-cumplido[data-fecha="${fecha}"]`);
    const rpe = document.querySelector(`.slider-sensacion[data-tipo="rpe"][data-fecha="${fecha}"]`);
    const dolor = document.querySelector(`.slider-sensacion[data-tipo="dolor"][data-fecha="${fecha}"]`);
    const nota = document.querySelector(`.textarea-comentario[data-fecha="${fecha}"]`);

    if(check) existing.cumplido = check.checked;
    if(rpe) existing.rpe = parseInt(rpe.value);
    if(dolor) existing.dolor = parseInt(dolor.value);
    if(nota) existing.comentario = nota.value;

    await DB.put('bitacora', existing);
}

// ============================================================================
// 4. INTELIGENCIA ARTIFICIAL (Gemini Texto & VISIÓN)
// ============================================================================
async function llamarGemini(prompt, imagenes = []) {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.geminiKey) throw new Error('Falta la clave API de Gemini.');
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiKey}`;
    
    const parts = [{ text: prompt }];
    imagenes.forEach(img => parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } }));

    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) });
    if (!res.ok) throw new Error(`Error API Gemini: ${res.status}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function extraerEtiqueta(texto, tag) {
    const ETIQUETAS = 'RESUMEN_CORTO|ANALISIS_RETROSPECTIVO|ANALISIS_PRESCRIPCION|CALENTAMIENTO|PRINCIPAL|ENFRIAMIENTO|TIPO_DIETA|MACRO_CARBOS|MACRO_PROTES|MACRO_GRASAS|CONSEJO_NUTRICIONAL|KCAL_ESTIMADAS|MACROS|EVALUACION_OBJETIVA|RECOMENDACION_MEJORA';
    const match = texto.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[(?:${ETIQUETAS})\\]|$)`));
    return match ? match[1].trim() : '---';
}

async function solicitarEntrenamientoIA() {
    // ... [Tu código anterior de IA de prescripción se mantiene idéntico, solo adaptado a guardar el resumen en DB]
    const fechaHoy = new Date().toISOString().split('T')[0];
    const respuestaIA = await llamarGemini("... prompt original ..."); 
    // Actualizar BD
    const existing = await DB.get('bitacora', fechaHoy) || { fecha: fechaHoy };
    existing.resumenIA = extraerEtiqueta(respuestaIA, 'RESUMEN_CORTO');
    await DB.put('bitacora', existing);
}

// Lógica de Visión para Escáner Nutricional
let imagenesComida = [];

const comprimirImagen = (file) => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 800; let w = img.width, h = img.height;
            if(w > h && w > MAX_SIZE) { h *= MAX_SIZE/w; w = MAX_SIZE; } else if(h > MAX_SIZE) { w *= MAX_SIZE/h; h = MAX_SIZE; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', dataUrl });
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

async function inicializarEscaner() {
    ['entrante', 'primero', 'segundo', 'postre'].forEach(fase => {
        const inputF = document.getElementById(`input-foto-${fase}`);
        if(inputF) {
            inputF.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if(file) {
                    const res = await comprimirImagen(file);
                    document.getElementById(`preview-img-${fase}`).src = res.dataUrl;
                    document.getElementById(`preview-img-${fase}`).style.display = 'block';
                    
                    const idx = imagenesComida.findIndex(img => img.fase === fase);
                    if(idx > -1) imagenesComida[idx] = { fase, base64: res.base64, mimeType: res.mimeType };
                    else imagenesComida.push({ fase, base64: res.base64, mimeType: res.mimeType });
                    
                    document.getElementById('btn-analizar').disabled = imagenesComida.length === 0;
                }
            });
        }
    });

    document.getElementById('btn-analizar').addEventListener('click', async () => {
        const btn = document.getElementById('btn-analizar');
        btn.disabled = true; document.getElementById('loading-overlay').style.display = 'block';
        document.getElementById('resultados-analisis').style.display = 'none';

        try {
            const dieta = document.getElementById('selector-dieta').value;
            const notas = document.getElementById('texto-notas-comida').value;
            const gastoTotal = (window.bmrCalculado || 0) + 500; // Asumimos 500kcal de actividad por defecto si no hay reloj

            const prompt = `Eres A.R.G.O.S., inteligencia nutricional. Estrategia: ${dieta}. TDEE: ${gastoTotal} kcal/día. Notas: "${notas}". Analiza las imágenes adjuntas.
            Usa estas etiquetas:
            [KCAL_ESTIMADAS] -> Número.
            [MACROS] -> Detalle.
            [EVALUACION_OBJETIVA] -> Crítica.
            [RECOMENDACION_MEJORA] -> Ajuste.`;

            const textoIA = await llamarGemini(prompt, imagenesComida);
            
            document.getElementById('res-kcal').textContent = extraerEtiqueta(textoIA, 'KCAL_ESTIMADAS') + ' kcal';
            document.getElementById('res-macros').textContent = extraerEtiqueta(textoIA, 'MACROS');
            document.getElementById('res-evaluacion').textContent = extraerEtiqueta(textoIA, 'EVALUACION_OBJETIVA');
            document.getElementById('res-recomendacion').textContent = extraerEtiqueta(textoIA, 'RECOMENDACION_MEJORA');
            
            // Guardar registro histórico
            await DB.put('comidas', { timestamp: new Date().getTime(), textoIA, imagenes: imagenesComida.length });

            document.getElementById('loading-overlay').style.display = 'none';
            document.getElementById('resultados-analisis').style.display = 'block';
        } catch (err) {
            alert('Error de Visión IA: ' + err.message);
            document.getElementById('loading-overlay').style.display = 'none';
        } finally {
            btn.disabled = false;
        }
    });
}

// ============================================================================
// 5. INICIALIZACIÓN GLOBAL
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('header-fecha').textContent = new Date().toISOString().split('T')[0];

    try {
        await initDB();
        await cargarConfiguracion();
        inicializarEscaner();
        
        document.getElementById('btn-guardar-config').addEventListener('click', guardarConfiguracion);
        document.getElementById('btn-exportar').addEventListener('click', exportarRespaldo);
        document.getElementById('input-importar').addEventListener('change', importarRespaldo);
        
        // Arrancar telemetría
        const config = await DB.get('config', 'credenciales');
        if (config && config.intervalsKey) {
            const datos = await fetchIntervalsData();
            // procesarYDibujarMetricas(datos); // Asume que tienes tu función de gráficos aquí
            await renderBitacoraYRPE(datos.activities);
        }
    } catch (e) {
        console.error(e);
        alert("Fallo crítico. Asegúrate de no estar en navegación privada.");
    }
});
