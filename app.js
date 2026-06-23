// app.js - A.R.G.O.S. Motor Lógico Local (PWA) Final - Versión Completa
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
    }
};

// ============================================================================
// 2. CONFIGURACIÓN Y COPIAS DE SEGURIDAD
// ============================================================================
async function cargarConfiguracion() {
    const config = await DB.get('config', 'credenciales');
    if (config) {
        document.getElementById('cfg-athlete-id').value = config.athleteId || '';
        document.getElementById('cfg-intervals-key').value = config.intervalsKey || '';
        document.getElementById('cfg-gemini-key').value = config.geminiKey || '';
        document.getElementById('cfg-nombre-atleta').value = config.nombre || 'Atleta';
        document.getElementById('cfg-meta-principal').value = config.meta || 'Preparación base.';
        document.getElementById('header-atleta').textContent = config.nombre || 'Atleta';
        document.getElementById('objetivo-actual').textContent = config.meta || 'Preparación base.';
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
        meta: document.getElementById('cfg-meta-principal').value.trim(),
        lesiones: document.getElementById('texto-lesiones').value.trim()
    };
    await DB.put('config', configData);
    document.getElementById('header-atleta').textContent = configData.nombre;
    document.getElementById('objetivo-actual').textContent = configData.meta;
    alert('Configuración guardada en el dispositivo.');
    location.reload();
}

async function exportarRespaldo() {
    const data = { config: await DB.getAll('config'), bitacora: await DB.getAll('bitacora'), comidas: await DB.getAll('comidas') };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
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
        } catch (err) { alert('Error al leer el archivo de respaldo.'); }
    };
    reader.readAsText(file);
}

// ============================================================================
// 3. TELEMETRÍA (Intervals), MULTIDEPORTE Y GRÁFICOS
// ============================================================================
async function fetchIntervalsData() {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.athleteId || !config.intervalsKey) throw new Error('Faltan credenciales de Intervals.');
    const token = btoa('API_KEY:' + config.intervalsKey);
    const headers = { 'Authorization': `Basic ${token}` };
    
    const hoy = new Date(); const hace14Dias = new Date(); hace14Dias.setDate(hoy.getDate() - 14);
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

    // --- 1. ZONAS DE FATIGA Y UI PRINCIPAL ---
    const ultimoRegistro = wellness[wellness.length - 1];
    const latestForm = Math.round((ultimoRegistro.ctl || 0) - (ultimoRegistro.atl || 0));

    let zonaFatiga = "Mantenimiento"; let colorFatiga = "#8b949e";
    if (latestForm > 5) { zonaFatiga = "FRESCO"; colorFatiga = "#79c0ff"; }
    else if (latestForm >= -10 && latestForm <= 5) { zonaFatiga = "MANTENIMIENTO"; colorFatiga = "#ff2a2a"; }
    else if (latestForm >= -30 && latestForm < -10) { zonaFatiga = "ESTÍMULO"; colorFatiga = "#56d364"; }
    else if (latestForm < -30) { zonaFatiga = "SOBREENTRENAMIENTO"; colorFatiga = "#ff2a2a"; }

    document.getElementById('val-fatiga').innerHTML = `<span style="color:${colorFatiga}">${zonaFatiga}<br><small style="color:#666; font-family:'Consolas',monospace;">TSB: ${latestForm}</small></span>`;
    document.getElementById('ticker-hrv').textContent = ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--';
    document.getElementById('ticker-rhr').textContent = ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--';
    document.getElementById('card-hrv-val').textContent = (ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--') + ' ms';
    document.getElementById('card-rhr-val').textContent = (ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--') + ' bpm';
    document.getElementById('val-intensidad').innerHTML = '<span style="color:#56d364">ACTUALIZADO ✓</span>';

    // --- 2. CÁLCULO RADAR MULTIDEPORTE Y CALORÍAS ---
    const hoyDate = new Date();
    const strLunesActual = new Date(hoyDate.setDate(hoyDate.getDate() - ((hoyDate.getDay() + 6) % 7))).toISOString().split('T')[0];
    
    const initWeek = () => ({ runKm:0, runSecs:0, rideKm:0, rideSecs:0, swimKm:0, swimSecs:0, strSecs:0, carga:0, kcal:0 });
    const wAnterior = initWeek(), wActual = initWeek();
    let totalKcalActivas = 0, diasConActividad = 0;
    const mapaCarga = {};

    activities.forEach(act => {
        const fecha = act.start_date_local.split('T')[0];
        const target = (fecha >= strLunesActual) ? wActual : wAnterior;
        
        const carga = act.icu_training_load || 0;
        const kcal = act.calories || 0;
        const dist = (typeof act.distance === 'number' ? act.distance : 0) / 1000;
        const secs = typeof act.moving_time === 'number' ? act.moving_time : 0;
        const tipo = act.type || '';

        target.carga += Math.round(carga);
        target.kcal += Math.round(kcal);
        if(kcal > 0) { totalKcalActivas += kcal; diasConActividad++; }
        mapaCarga[fecha] = (mapaCarga[fecha] || 0) + carga;

        if (['Run', 'VirtualRun', 'Treadmill', 'TrailRun'].includes(tipo)) { target.runKm += dist; target.runSecs += secs; }
        else if (['Ride', 'VirtualRide', 'IndoorCycling', 'GravelRide', 'MountainBikeRide'].includes(tipo)) { target.rideKm += dist; target.rideSecs += secs; }
        else if (['Swim', 'OpenWaterSwim'].includes(tipo)) { target.swimKm += dist; target.swimSecs += secs; }
        else if (['WeightTraining', 'Workout', 'Strength', 'Crossfit'].includes(tipo)) target.strSecs += secs;
    });

    // Guardar gasto promedio global para el motor de nutrición
    window.avgCaloriasActivas = diasConActividad > 0 ? Math.round(totalKcalActivas / diasConActividad) : 500;
    document.getElementById('val-gasto-promedio').textContent = window.avgCaloriasActivas + " kcal";

    const formatTime = (secs) => { const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60); return h===0 ? (m===0 ? '0m' : `${m}m`) : `${h}h${m.toString().padStart(2,'0')}m`; };
    const boxSem = (tit, w, isAct) => `
        <div class="box-summary box-multisport" style="border-left-color: ${isAct ? 'var(--primary)' : '#555'};">
            <div class="multisport-title" style="color: ${isAct ? 'var(--primary)' : '#888'};">${tit}</div>
            <div class="multisport-row"><span class="ms-label">🏃 Carrera:</span> <span class="ms-val">${formatTime(w.runSecs)} | ${w.runKm.toFixed(1)}km</span></div>
            <div class="multisport-row"><span class="ms-label">🚴 Ciclismo:</span> <span class="ms-val">${formatTime(w.rideSecs)} | ${w.rideKm.toFixed(1)}km</span></div>
            <div class="multisport-row"><span class="ms-label">🏊 Natación:</span> <span class="ms-val">${formatTime(w.swimSecs)} | ${w.swimKm.toFixed(1)}km</span></div>
            <div class="multisport-row"><span class="ms-label">🏋️ Fuerza:</span> <span class="ms-val">${formatTime(w.strSecs)}</span></div>
            <div class="multisport-row" style="margin-top:6px; border-top:1px solid #222; padding-top:6px;"><span class="ms-label" style="color:#ff8800;">🔥 Kcal Act.:</span> <span class="ms-val" style="color:#ff8800;">${w.kcal}</span></div>
            <div class="multisport-row"><span class="ms-label" style="color:var(--primary);">📈 Carga:</span> <span class="ms-val" style="color:var(--primary);">${w.carga}</span></div>
        </div>`;
    document.getElementById('container-sem-anterior').innerHTML = boxSem('Semana Anterior', wAnterior, false);
    document.getElementById('container-sem-actual').innerHTML = boxSem('Semana Actual', wActual, true);

    // --- 3. DIBUJAR GRÁFICOS ---
    const labels = wellness.map(d => d.id.slice(5)); 
    Chart.defaults.color = '#666'; Chart.defaults.borderColor = '#1a1a1a'; Chart.defaults.font.family = "'Consolas', monospace"; 
    if(window.graficoFisio) window.graficoFisio.destroy(); if(window.graficoCarga) window.graficoCarga.destroy();

    window.graficoFisio = new Chart(document.getElementById('canvasFisiologia').getContext('2d'), { 
        type: 'line', 
        data: { labels: labels, datasets: [
            { label: 'HRV', data: wellness.map(d => d.hrv || null), borderColor: '#555', backgroundColor: 'rgba(85,85,85,0.1)', fill: true, tension: 0.1 }, 
            { label: 'RHR', data: wellness.map(d => d.restingHR || null), borderColor: 'var(--primary)', backgroundColor: 'rgba(255,42,42,0.1)', fill: true, tension: 0.1 }
        ]}, options: { responsive: true, maintainAspectRatio: false } 
    });

    window.graficoCarga = new Chart(document.getElementById('canvasEsfuerzo').getContext('2d'), { 
        type: 'line', 
        data: { labels: labels, datasets: [
            { label: 'Fitness (CTL)', data: wellness.map(d => d.ctl || null), borderColor: '#ff8800', fill: true, tension: 0.1, yAxisID: 'y' }, 
            { label: 'Impacto', data: wellness.map(d => mapaCarga[d.id] || 0), type: 'bar', backgroundColor: 'var(--primary)', borderColor: 'var(--primary)', yAxisID: 'y1' }
        ]}, options: { responsive: true, maintainAspectRatio: false, scales: { y: { position: 'left' }, y1: { grid: { drawOnChartArea: false }, position: 'right' } } } 
    });
}

// --- 4. BITÁCORA Y BARRA DE PROGRESO ---
async function renderBitacoraYRPE(activities) {
    const bitacoraData = await DB.getAll('bitacora');
    const fechasMap = new Map();
    let cumplidos = 0;

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
            if (b.cumplido) cumplidos++;
        }
    });

    // Actualizar Barra de Progreso Semanal (sobre 14 días)
    const pct = Math.min(100, Math.round((cumplidos / 14) * 100));
    document.getElementById('val-pct-plan').textContent = `${pct}%`;
    document.querySelector('.progress-bar-fill').style.width = `${pct}%`;

    let htmlGrid = '<div class="bitacora-header"><div>Día</div><div>Actividad</div><div>Prescripción</div></div>';
    let htmlRPE = '';

    fechasMap.forEach((data, fecha) => {
        const acts = data.real.length > 0 ? data.real.join(', ') : '<span style="color:#505050">SIN REGISTRO</span>';
        const checked = data.cumplido ? 'checked' : '';
        const fCorto = fecha.slice(5);

        htmlGrid += `<div class="bitacora-row"><div class="bitacora-cell date-cell">${fCorto}</div><div class="bitacora-cell real-cell">${acts}</div><div class="bitacora-cell ia-cell"><label style="cursor:pointer; display:flex; gap:6px;"><input type="checkbox" class="check-cumplido" data-fecha="${fecha}" ${checked}><span>${data.resumenIA || 'Libre'}</span></label></div></div>`;
        htmlRPE += `<div class="bloque-entrenamiento sensacion-card"><div class="sensacion-header"><h4 class="sensacion-titulo">${fecha}</h4><span class="sensacion-resumen">${acts}</span></div><div class="sensacion-sliders"><div><div class="slider-row"><label class="slider-label">ESFUERZO (RPE)</label><span id="val-rpe-${fecha}" class="slider-val rpe-val">${data.rpe}/10</span></div><input type="range" min="1" max="10" value="${data.rpe}" class="slider-sensacion" data-tipo="rpe" data-fecha="${fecha}"></div><div><div class="slider-row"><label class="slider-label">DOLOR</label><span id="val-dolor-${fecha}" class="slider-val dolor-val">${data.dolor}/10</span></div><input type="range" min="1" max="10" value="${data.dolor}" class="slider-sensacion" data-tipo="dolor" data-fecha="${fecha}"></div></div><textarea class="textarea-comentario" data-fecha="${fecha}" placeholder="Notas médicas...">${data.comentario}</textarea></div>`;
    });

    document.getElementById('bitacora-list').innerHTML = htmlGrid;
    document.getElementById('sensaciones-list').innerHTML = htmlRPE;

    document.querySelectorAll('.slider-sensacion').forEach(s => { s.addEventListener('input', e => document.getElementById(`val-${e.target.dataset.tipo}-${e.target.dataset.fecha}`).textContent = e.target.value + '/10'); s.addEventListener('change', e => guardarEstadoBitacora(e.target.dataset.fecha)); });
    document.querySelectorAll('.textarea-comentario, .check-cumplido').forEach(el => el.addEventListener('change', e => guardarEstadoBitacora(e.target.dataset.fecha)));
}

async function guardarEstadoBitacora(fecha) {
    const existing = await DB.get('bitacora', fecha) || { fecha };
    const check = document.querySelector(`.check-cumplido[data-fecha="${fecha}"]`);
    if(check) existing.cumplido = check.checked;
    existing.rpe = parseInt(document.querySelector(`.slider-sensacion[data-tipo="rpe"][data-fecha="${fecha}"]`)?.value || 5);
    existing.dolor = parseInt(document.querySelector(`.slider-sensacion[data-tipo="dolor"][data-fecha="${fecha}"]`)?.value || 1);
    existing.comentario = document.querySelector(`.textarea-comentario[data-fecha="${fecha}"]`)?.value || '';
    await DB.put('bitacora', existing);
    
    // Si marcamos el checkbox, repintamos la barra de progreso sin recargar la página
    if(check) {
        const bitacoraData = await DB.getAll('bitacora');
        const hoy = new Date(); const hace14 = new Date(hoy); hace14.setDate(hoy.getDate() - 14);
        const strHace14 = hace14.toISOString().split('T')[0];
        const cumplidos = bitacoraData.filter(b => b.cumplido && b.fecha >= strHace14).length;
        const pct = Math.min(100, Math.round((cumplidos / 14) * 100));
        document.getElementById('val-pct-plan').textContent = `${pct}%`;
        document.querySelector('.progress-bar-fill').style.width = `${pct}%`;
    }
}

// ============================================================================
// 5. INTELIGENCIA ARTIFICIAL (Gemini Texto & VISIÓN) + BMR
// ============================================================================
async function llamarGemini(prompt, imagenes = []) {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.geminiKey) throw new Error('Falta la clave API de Gemini.');
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiKey}`;
    const parts = [{ text: prompt }];
    imagenes.forEach(img => parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } }));

    let ultimoError;
    for (let intento = 0; intento < 3; intento++) {
        if (intento > 0) { console.warn('Reintento IA...'); await new Promise(r => setTimeout(r, Math.pow(2, intento) * 1000)); }
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) });
            if (res.status === 429 || res.status >= 500) { ultimoError = new Error(`Error API: ${res.status}`); continue; }
            if (!res.ok) throw new Error(`Error API: ${res.status}`);
            const json = await res.json();
            return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        } catch (err) { ultimoError = err; if (!err.message.includes('503') && !err.message.includes('429')) throw err; }
    }
    throw new Error('Servidores IA saturados. Inténtalo en un minuto.');
}

function extraerEtiqueta(texto, tag) {
    const match = texto.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[(?:RESUMEN_CORTO|ANALISIS_PRESCRIPCION|CALENTAMIENTO|PRINCIPAL|ENFRIAMIENTO|TIPO_DIETA|MACRO_CARBOS|MACRO_PROTES|MACRO_GRASAS|CONSEJO_NUTRICIONAL|KCAL_ESTIMADAS|MACROS|EVALUACION_OBJETIVA|RECOMENDACION_MEJORA)\\]|$)`));
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
        const memoria = config?.meta || 'Preparación base';
        const lesiones = document.getElementById('texto-lesiones').value || 'Ninguna lesión activa.';
        const intencionHoy = document.getElementById('input-intencion-hoy').value.trim();
        
        const bloqueIntencion = intencionHoy ? `\n=== PREFERENCIA DEL ATLETA PARA HOY ===\nEl atleta ha expresado este deseo: "${intencionHoy}". ADAPTA la sesión a esto si es fisiológicamente seguro.\n` : '';

        const prompt = `Eres A.R.G.O.S., IA deportiva para ${nombreAtleta}.
        === OBJETIVO PRINCIPAL ===
        "${memoria}"
        === ESTADO MÉDICO Y LESIONES ===
        "${lesiones}" (EVITA zonas lesionadas).
        === SITUACIÓN HOY ===
        HRV: ${document.getElementById('ticker-hrv').textContent}
        Fatiga: ${document.getElementById('val-fatiga').innerText}
        ${bloqueIntencion}
        Diseña la sesión de hoy. Usa estas etiquetas:
        [RESUMEN_CORTO] -> 10 palabras.
        [ANALISIS_PRESCRIPCION] -> Explicación.
        [CALENTAMIENTO] -> Activación.
        [PRINCIPAL] -> Núcleo.
        [ENFRIAMIENTO] -> Calma.
        [CONSEJO_NUTRICIONAL] -> Pautas para el día.`;

        const respuestaIA = await llamarGemini(prompt);

        containerAnalisis.innerHTML = `<p>${extraerEtiqueta(respuestaIA, 'ANALISIS_PRESCRIPCION')}</p>`;
        containerSesion.innerHTML = `
            <div class="seccion-ruta"><div class="tag-ruta">Calentamiento</div>${extraerEtiqueta(respuestaIA, 'CALENTAMIENTO')}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Principal</div>${extraerEtiqueta(respuestaIA, 'PRINCIPAL')}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Enfriamiento</div>${extraerEtiqueta(respuestaIA, 'ENFRIAMIENTO')}</div>
        `;
        document.getElementById('val-nutricion-consejo').textContent = extraerEtiqueta(respuestaIA, 'CONSEJO_NUTRICIONAL');

        const fechaHoy = new Date().toISOString().split('T')[0];
        const existing = await DB.get('bitacora', fechaHoy) || { fecha: fechaHoy };
        existing.resumenIA = extraerEtiqueta(respuestaIA, 'RESUMEN_CORTO');
        await DB.put('bitacora', existing);

    } catch (error) {
        containerAnalisis.innerHTML = `<p style="color:#ff2a2a;">Fallo IA: ${error.message}</p>`;
        if (btn) btn.style.display = 'block';
    }
}

// BMR y Nutrición Vision
function actualizarMetabolismo() {
    const genero = document.getElementById('calc-genero')?.value || 'M';
    const edad = parseInt(document.getElementById('calc-edad')?.value) || 30;
    const peso = parseFloat(document.getElementById('calc-peso')?.value) || 75;
    const altura = parseInt(document.getElementById('calc-altura')?.value) || 175;
    
    let bmr = (10 * peso) + (6.25 * altura) - (5 * edad);
    bmr += (genero === 'M') ? 5 : -161;
    window.bmrCalculado = Math.round(bmr);
    
    const resBmr = document.getElementById('res-bmr'); const resTdee = document.getElementById('res-tdee');
    if (resBmr) resBmr.textContent = window.bmrCalculado + " kcal";
    if (resTdee) resTdee.textContent = Math.round(window.bmrCalculado * 1.2) + " kcal";

    localStorage.setItem('argos_metabolismo', JSON.stringify({genero, edad, peso, altura}));
}

function inicializarEscanerNutricional() {
    const meta = JSON.parse(localStorage.getItem('argos_metabolismo'));
    if(meta) {
        if(document.getElementById('calc-genero')) document.getElementById('calc-genero').value = meta.genero;
        if(document.getElementById('calc-edad')) document.getElementById('calc-edad').value = meta.edad;
        if(document.getElementById('calc-peso')) document.getElementById('calc-peso').value = meta.peso;
        if(document.getElementById('calc-altura')) document.getElementById('calc-altura').value = meta.altura;
    }
    ['input', 'change'].forEach(evt => {
        document.getElementById('calc-genero')?.addEventListener(evt, actualizarMetabolismo);
        document.getElementById('calc-edad')?.addEventListener(evt, actualizarMetabolismo);
        document.getElementById('calc-peso')?.addEventListener(evt, actualizarMetabolismo);
        document.getElementById('calc-altura')?.addEventListener(evt, actualizarMetabolismo);
    });
    actualizarMetabolismo();

    let imagenesComida = [];
    ['entrante', 'primero', 'segundo', 'postre'].forEach(fase => {
        const inputF = document.getElementById(`input-foto-${fase}`);
        if(inputF) {
            inputF.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if(file) {
                    const reader = new FileReader();
                    reader.onload = e2 => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            let w = img.width, h = img.height;
                            if(w > h && w > 800) { h *= 800/w; w = 800; } else if(h > 800) { w *= 800/h; h = 800; }
                            canvas.width = w; canvas.height = h;
                            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                            const base64 = dataUrl.split(',')[1];
                            
                            document.getElementById(`preview-img-${fase}`).src = dataUrl;
                            document.getElementById(`preview-img-${fase}`).style.display = 'block';
                            
                            const idx = imagenesComida.findIndex(i => i.fase === fase);
                            if(idx > -1) imagenesComida[idx] = { fase, base64, mimeType: 'image/jpeg' };
                            else imagenesComida.push({ fase, base64, mimeType: 'image/jpeg' });
                            
                            document.getElementById('btn-analizar').disabled = imagenesComida.length === 0;
                        };
                        img.src = e2.target.result;
                    };
                    reader.readAsDataURL(file);
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
            const gastoTotal = (window.bmrCalculado || 0) + (window.avgCaloriasActivas || 500);

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
        } catch (err) { alert('Error IA: ' + err.message); document.getElementById('loading-overlay').style.display = 'none'; } 
        finally { btn.disabled = false; }
    });
}

// ============================================================================
// 6. INICIALIZACIÓN GLOBAL Y TEMA
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('header-fecha').textContent = new Date().toISOString().split('T')[0];

    try {
        await initDB();
        await cargarConfiguracion();
        inicializarEscanerNutricional();
        
        document.getElementById('btn-guardar-config').addEventListener('click', guardarConfiguracion);
        document.getElementById('btn-exportar').addEventListener('click', exportarRespaldo);
        document.getElementById('input-importar').addEventListener('change', importarRespaldo);
        
        const config = await DB.get('config', 'credenciales');
        if (config && config.intervalsKey) {
            const datos = await fetchIntervalsData();
            procesarYDibujarMetricas(datos);
            await renderBitacoraYRPE(datos.activities);
        }

        if (config && config.geminiKey) {
            document.getElementById('contenedor-sesion-prescrita').innerHTML = `<button id="btn-generar-ia" class="file-upload-btn" style="width:100%; padding:15px; margin-top:10px; font-size:14px; background:var(--primary); color:#fff;">⚡ SOLICITAR ENTRENAMIENTO DE HOY</button>`;
            document.getElementById('btn-generar-ia').addEventListener('click', solicitarEntrenamientoIA);
        }

    } catch (e) { alert("Fallo crítico en el almacenamiento. Usa el navegador normal."); }
});

const colorPicker = document.getElementById('theme-color-picker');
function setThemeColor(hex) { 
    const r=parseInt(hex.substr(1,2),16), g=parseInt(hex.substr(3,2),16), b=parseInt(hex.substr(5,2),16);
    document.documentElement.style.setProperty('--primary', hex); 
    document.documentElement.style.setProperty('--primary-hover', `#${Math.max(0,r-30).toString(16).padStart(2,'0')}${Math.max(0,g-30).toString(16).padStart(2,'0')}${Math.max(0,b-30).toString(16).padStart(2,'0')}`);
    document.documentElement.style.setProperty('--primary-dark', `#${Math.max(0,r-80).toString(16).padStart(2,'0')}${Math.max(0,g-80).toString(16).padStart(2,'0')}${Math.max(0,b-80).toString(16).padStart(2,'0')}`);
    document.documentElement.style.setProperty('--primary-rgb', `${r},${g},${b}`); 
    localStorage.setItem('argos_theme_color', hex); if (colorPicker) colorPicker.value = hex; 
    
    if (typeof Chart !== 'undefined') Chart.instances.forEach(chart => { 
        let upd=false; chart.data.datasets.forEach(ds => { if (ds._isPri || ds.borderColor==='#ff2a2a' || ds.borderColor==='var(--primary)') { ds._isPri=true; ds.borderColor=hex; ds.backgroundColor=ds.type==='bar'?`rgba(${r},${g},${b},0.3)`:`rgba(${r},${g},${b},0.1)`; upd=true; } }); 
        if (upd) chart.update(); 
    }); 
}
if (colorPicker) colorPicker.addEventListener('input', (e) => setThemeColor(e.target.value));
const savedColor = localStorage.getItem('argos_theme_color');
if (savedColor) setTimeout(() => setThemeColor(savedColor), 100); else setTimeout(() => setThemeColor('#ff2a2a'), 100);
