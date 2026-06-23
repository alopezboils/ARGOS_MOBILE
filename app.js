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
// 3. TELEMETRÍA (Intervals.icu), GRÁFICOS Y BITÁCORA MÉDICA
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

function procesarYDibujarMetricas(datos) {
    const { wellness, activities } = datos;
    if (!wellness || wellness.length === 0) return;

    const ultimoRegistro = wellness[wellness.length - 1];
    const latestCTL = Math.round(ultimoRegistro.ctl || 0);
    const latestATL = Math.round(ultimoRegistro.atl || 0);
    const latestForm = latestCTL - latestATL; // TSB

    // 1. Zonas de Fatiga
    let zonaFatiga = "Mantenimiento"; let colorFatiga = "#8b949e";
    if (latestForm > 5) { zonaFatiga = "FRESCO"; colorFatiga = "#79c0ff"; }
    else if (latestForm >= -10 && latestForm <= 5) { zonaFatiga = "MANTENIMIENTO"; colorFatiga = "#ff2a2a"; }
    else if (latestForm >= -30 && latestForm < -10) { zonaFatiga = "ESTÍMULO"; colorFatiga = "#56d364"; }
    else if (latestForm < -30) { zonaFatiga = "SOBREENTRENAMIENTO"; colorFatiga = "#ff2a2a"; }

    // 2. Actualizar Interfaz
    document.getElementById('val-fatiga').innerHTML = `<span style="color:${colorFatiga}">${zonaFatiga}<br><small style="color:#666; font-family:'Consolas',monospace;">TSB: ${latestForm}</small></span>`;
    document.getElementById('ticker-hrv').textContent = ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--';
    document.getElementById('ticker-rhr').textContent = ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--';
    document.getElementById('card-hrv-val').textContent = (ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--') + ' ms';
    document.getElementById('card-rhr-val').textContent = (ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--') + ' bpm';
    document.getElementById('val-intensidad').innerHTML = '<span style="color:#56d364">ACTUALIZADO ✓</span>';

    // 3. Preparar Datos para Gráficos
    const labels = wellness.map(d => d.id.slice(5)); 
    const dataHRV = wellness.map(d => d.hrv || null);
    const dataRHR = wellness.map(d => d.restingHR || null);
    const dataFitness = wellness.map(d => d.ctl || null);
    
    const mapaCarga = {};
    activities.forEach(act => {
        const fecha = act.start_date_local.split('T')[0];
        mapaCarga[fecha] = (mapaCarga[fecha] || 0) + (act.icu_training_load || 0);
    });
    const dataCarga = wellness.map(d => mapaCarga[d.id] || 0);

    // 4. Dibujar Gráficos (Chart.js)
    Chart.defaults.color = '#666'; Chart.defaults.borderColor = '#1a1a1a'; Chart.defaults.font.family = "'Consolas', monospace"; 
    
    // Destruir gráficos anteriores si existen
    if(window.graficoFisio) window.graficoFisio.destroy();
    if(window.graficoCarga) window.graficoCarga.destroy();

    window.graficoFisio = new Chart(document.getElementById('canvasFisiologia').getContext('2d'), { 
        type: 'line', 
        data: { labels: labels, datasets: [
            { label: 'HRV', data: dataHRV, borderColor: '#555', backgroundColor: 'rgba(85,85,85,0.1)', fill: true, tension: 0.1 }, 
            { label: 'RHR', data: dataRHR, borderColor: 'var(--primary)', backgroundColor: 'rgba(255,42,42,0.1)', fill: true, tension: 0.1 }
        ]}, 
        options: { responsive: true, maintainAspectRatio: false } 
    });

    window.graficoCarga = new Chart(document.getElementById('canvasEsfuerzo').getContext('2d'), { 
        type: 'line', 
        data: { labels: labels, datasets: [
            { label: 'Fitness (CTL)', data: dataFitness, borderColor: '#ff8800', fill: true, tension: 0.1, yAxisID: 'y' }, 
            { label: 'Impacto', data: dataCarga, type: 'bar', backgroundColor: 'var(--primary)', borderColor: 'var(--primary)', yAxisID: 'y1' }
        ]}, 
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { position: 'left' }, y1: { grid: { drawOnChartArea: false }, position: 'right' } } } 
    });
}

async function renderBitacoraYRPE(activities) {
    globalActivities = activities;
    const bitacoraData = await DB.getAll('bitacora');
    const fechasMap = new Map();

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

        htmlGrid += `
            <div class="bitacora-row">
                <div class="bitacora-cell date-cell">${fCorto}</div>
                <div class="bitacora-cell real-cell">${acts}</div>
                <div class="bitacora-cell ia-cell">
                    <label style="cursor:pointer; display:flex; gap:6px;"><input type="checkbox" class="check-cumplido" data-fecha="${fecha}" ${checked}><span>${data.resumenIA || 'Libre'}</span></label>
                </div>
            </div>`;

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
    const btn = document.getElementById('btn-generar-ia');
    const containerSesion = document.getElementById('contenedor-sesion-prescrita');
    const containerAnalisis = document.getElementById('contenedor-analisis-ia');
    
    if (btn) btn.style.display = 'none';
    containerAnalisis.innerHTML = '<p style="color:#ff8800; font-family:\'Consolas\', monospace;">Conectando con A.R.G.O.S. IA...</p>';
    
    try {
        const config = await DB.get('config', 'credenciales');
        const nombreAtleta = config?.nombre || 'Atleta';
        const lesiones = document.getElementById('texto-lesiones').value || 'Ninguna lesión activa.';
        const hrvActual = document.getElementById('ticker-hrv').textContent;
        const formActual = document.getElementById('val-fatiga').innerText;

        const prompt = `Eres A.R.G.O.S., inteligencia artificial deportiva para ${nombreAtleta}. Tu tono es profesional y científico.
        
        === ESTADO MÉDICO Y LESIONES ===
        "${lesiones}" (EVITA prescribir ejercicios que impacten zonas lesionadas).
        
        === SITUACIÓN FISIOLÓGICA HOY ===
        HRV: ${hrvActual}
        Fatiga: ${formActual}
        
        Diseña la sesión de hoy integrada en la periodización.
        Estructura exactamente con estas etiquetas:
        [RESUMEN_CORTO] -> Resumen en 10 palabras.
        [ANALISIS_PRESCRIPCION] -> Explicación técnica de la sesión.
        [CALENTAMIENTO] -> Activación.
        [PRINCIPAL] -> Núcleo de la sesión.
        [ENFRIAMIENTO] -> Vuelta a la calma.
        [CONSEJO_NUTRICIONAL] -> Pautas para afrontar el día.`;

        const respuestaIA = await llamarGemini(prompt);

        const analisis = extraerEtiqueta(respuestaIA, 'ANALISIS_PRESCRIPCION');
        containerAnalisis.innerHTML = `<p>${analisis}</p>`;
        
        containerSesion.innerHTML = `
            <div class="seccion-ruta"><div class="tag-ruta">Calentamiento</div>${extraerEtiqueta(respuestaIA, 'CALENTAMIENTO')}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Principal</div>${extraerEtiqueta(respuestaIA, 'PRINCIPAL')}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Enfriamiento</div>${extraerEtiqueta(respuestaIA, 'ENFRIAMIENTO')}</div>
        `;
        document.getElementById('val-nutricion-consejo').textContent = extraerEtiqueta(respuestaIA, 'CONSEJO_NUTRICIONAL');

        // Guardar resumen en bitácora local
        const fechaHoy = new Date().toISOString().split('T')[0];
        const existing = await DB.get('bitacora', fechaHoy) || { fecha: fechaHoy };
        existing.resumenIA = extraerEtiqueta(respuestaIA, 'RESUMEN_CORTO');
        await DB.put('bitacora', existing);

    } catch (error) {
        containerAnalisis.innerHTML = `<p style="color:#ff2a2a;">Fallo IA: ${error.message}</p>`;
        if (btn) btn.style.display = 'block';
    }
}

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

function inicializarEscaner() {
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
            const gastoTotal = (window.bmrCalculado || 0) + 500;

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
        
        // Arrancar telemetría y UI si hay claves
        const config = await DB.get('config', 'credenciales');
        if (config && config.intervalsKey) {
            const datos = await fetchIntervalsData();
            procesarYDibujarMetricas(datos);
            await renderBitacoraYRPE(datos.activities);
        }

        // Inyectar botón de Inteligencia Artificial si hay clave
        if (config && config.geminiKey) {
            document.getElementById('contenedor-sesion-prescrita').innerHTML = `
                <button id="btn-generar-ia" class="file-upload-btn" style="width:100%; padding:15px; margin-top:10px; font-size:14px; background:var(--primary); color:#fff;">
                    ⚡ SOLICITAR ENTRENAMIENTO DE HOY
                </button>
            `;
            document.getElementById('btn-generar-ia').addEventListener('click', solicitarEntrenamientoIA);
            document.getElementById('contenedor-analisis-ia').innerHTML = '<p style="color:#888; font-style:italic;">Sistema IA en reposo. Esperando solicitud manual.</p>';
        }

    } catch (e) {
        console.error(e);
        alert("Fallo crítico. Asegúrate de no estar en navegación privada.");
    }
});

// ============================================================================
// 6. CONTROL DE TEMA VISUAL (Color Picker)
// ============================================================================
const colorPicker = document.getElementById('theme-color-picker');

function hexToRgb(hex) { 
    let r=0, g=0, b=0; 
    if(hex.length === 4) { r = parseInt(hex[1]+hex[1], 16); g = parseInt(hex[2]+hex[2], 16); b = parseInt(hex[3]+hex[3], 16); } 
    else if(hex.length === 7) { r = parseInt(hex.substring(1,3), 16); g = parseInt(hex.substring(3,5), 16); b = parseInt(hex.substring(5,7), 16); } 
    return `${r}, ${g}, ${b}`; 
}

function adjustColor(hex, amount) { 
    let color = hex.replace('#', ''); 
    if (color.length === 3) color = color[0]+color[0]+color[1]+color[1]+color[2]+color[2]; 
    let r = Math.max(0, Math.min(255, parseInt(color.substring(0, 2), 16) + amount)); 
    let g = Math.max(0, Math.min(255, parseInt(color.substring(2, 4), 16) + amount)); 
    let b = Math.max(0, Math.min(255, parseInt(color.substring(4, 6), 16) + amount)); 
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`; 
}

function setThemeColor(hex) { 
    const root = document.documentElement; 
    const rgb = hexToRgb(hex); 
    
    root.style.setProperty('--primary', hex); 
    root.style.setProperty('--primary-hover', adjustColor(hex, 40)); 
    root.style.setProperty('--primary-dark', adjustColor(hex, -80)); 
    root.style.setProperty('--primary-rgb', rgb); 
    
    localStorage.setItem('argos_theme_color', hex); 
    if (colorPicker) colorPicker.value = hex; 
    
    if (typeof Chart !== 'undefined') {
        Chart.instances.forEach(chart => { 
            let updated = false; 
            chart.data.datasets.forEach(ds => { 
                if (ds._isPrimaryTheme || ds.borderColor === '#ff2a2a' || ds.borderColor === 'var(--primary)') { 
                    ds._isPrimaryTheme = true; 
                    ds.borderColor = hex; 
                    ds.backgroundColor = ds.type === 'bar' ? `rgba(${rgb}, 0.3)` : `rgba(${rgb}, 0.1)`; 
                    updated = true; 
                } 
            }); 
            if (updated) { 
                chart.options.plugins.tooltip.borderColor = hex; 
                chart.options.plugins.tooltip.titleColor = hex; 
                chart.update(); 
            } 
        }); 
    }
}

if (colorPicker) colorPicker.addEventListener('input', (e) => setThemeColor(e.target.value));

const savedThemeColor = localStorage.getItem('argos_theme_color');
if (savedThemeColor) setTimeout(() => setThemeColor(savedThemeColor), 100); 
else setTimeout(() => setThemeColor('#ff2a2a'), 100);
