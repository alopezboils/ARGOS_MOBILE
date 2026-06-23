// app.js - A.R.G.O.S. Motor Lógico Local (PWA) Completo
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
            
            if (!database.objectStoreNames.contains('config')) {
                database.createObjectStore('config', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('bitacora')) {
                database.createObjectStore('bitacora', { keyPath: 'fecha' });
            }
            if (!database.objectStoreNames.contains('comidas')) {
                database.createObjectStore('comidas', { keyPath: 'timestamp' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('[Obi-Wan] Base de datos enlazada con éxito.');
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('[Obi-Wan] Error crítico en la base de datos:', event.target.errorCode);
            reject(event.target.error);
        };
    });
}

const DB = {
    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },
    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
};

// ============================================================================
// 2. GESTIÓN DE CONFIGURACIÓN Y CREDENCIALES
// ============================================================================
async function cargarConfiguracion() {
    const config = await DB.get('config', 'credenciales');
    if (config) {
        document.getElementById('cfg-athlete-id').value = config.athleteId || '';
        document.getElementById('cfg-intervals-key').value = config.intervalsKey || '';
        document.getElementById('cfg-gemini-key').value = config.geminiKey || '';
        document.getElementById('cfg-nombre-atleta').value = config.nombre || 'Atleta';
        document.getElementById('header-atleta').textContent = config.nombre || 'Atleta';
    }
    return config;
}

async function guardarConfiguracion() {
    const btn = document.getElementById('btn-guardar-config');
    btn.textContent = '⏳ GUARDANDO...';
    
    const configData = {
        id: 'credenciales',
        athleteId: document.getElementById('cfg-athlete-id').value.trim(),
        intervalsKey: document.getElementById('cfg-intervals-key').value.trim(),
        geminiKey: document.getElementById('cfg-gemini-key').value.trim(),
        nombre: document.getElementById('cfg-nombre-atleta').value.trim()
    };

    try {
        await DB.put('config', configData);
        document.getElementById('header-atleta').textContent = configData.nombre;
        btn.textContent = '✓ CONFIGURACIÓN GUARDADA';
        btn.style.background = '#56d364';
        btn.style.color = '#000';
        setTimeout(() => {
            btn.textContent = '💾 GUARDAR CONFIGURACIÓN';
            btn.style.background = '#ff8800';
        }, 2000);
        
        iniciarTelemetria();
    } catch (error) {
        btn.textContent = '❌ ERROR AL GUARDAR';
        btn.style.background = '#ff2a2a';
    }
}

// ============================================================================
// 3. COMUNICACIONES Y CÁLCULO FISIOLÓGICO (Intervals.icu)
// ============================================================================
async function fetchIntervalsData() {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.athleteId || !config.intervalsKey) {
        throw new Error('Faltan credenciales de Intervals.');
    }

    const token = btoa('API_KEY:' + config.intervalsKey);
    const headers = { 'Authorization': `Basic ${token}` };
    
    const hoy = new Date();
    const hace14Dias = new Date();
    hace14Dias.setDate(hoy.getDate() - 14);
    
    const strHoy = hoy.toISOString().split('T')[0];
    const strInicio = hace14Dias.toISOString().split('T')[0];

    console.log('[Obi-Wan] Descargando telemetría de bienestar y actividades...');
    
    const [resWellness, resActivities] = await Promise.all([
        fetch(`https://intervals.icu/api/v1/athlete/${config.athleteId}/wellness?oldest=${strInicio}&newest=${strHoy}`, { headers }),
        fetch(`https://intervals.icu/api/v1/athlete/${config.athleteId}/activities?oldest=${strInicio}&newest=${strHoy}`, { headers })
    ]);

    if (!resWellness.ok || !resActivities.ok) throw new Error('Fallo en la matriz de comunicación de Intervals.');

    return {
        wellness: await resWellness.json(),
        activities: await resActivities.json()
    };
}

function procesarYDibujarMetricas(datos) {
    const { wellness, activities } = datos;
    
    if (wellness.length === 0) throw new Error('No hay datos médicos recientes.');

    const ultimoRegistro = wellness[wellness.length - 1];
    const latestCTL = Math.round(ultimoRegistro.ctl || 0);
    const latestATL = Math.round(ultimoRegistro.atl || 0);
    const latestForm = latestCTL - latestATL; // TSB

    // 1. Calcular Zonas de Fatiga
    let zonaFatiga = "Mantenimiento";
    let colorFatiga = "#8b949e";

    if (latestForm > 5) { zonaFatiga = "FRESCO / DESCARGA"; colorFatiga = "#79c0ff"; }
    else if (latestForm >= -10 && latestForm <= 5) { zonaFatiga = "ZONA ÓPTIMA: MANTENIMIENTO"; colorFatiga = "#ff2a2a"; }
    else if (latestForm >= -30 && latestForm < -10) { zonaFatiga = "ZONA ÓPTIMA: ESTÍMULO"; colorFatiga = "#56d364"; }
    else if (latestForm < -30) { zonaFatiga = "ALERTA: SOBREENTRENAMIENTO"; colorFatiga = "#ff2a2a"; }

    // 2. Actualizar UI Principal
    document.getElementById('val-fatiga').innerHTML = `<span style="color:${colorFatiga}">${zonaFatiga}<br><small style="color:#666; font-weight:normal; font-family:'Consolas',monospace;">TSB: ${latestForm}</small></span>`;
    
    document.getElementById('ticker-hrv').textContent = ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--';
    document.getElementById('ticker-rhr').textContent = ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--';
    document.getElementById('card-hrv-val').textContent = (ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--') + ' ms';
    document.getElementById('card-rhr-val').textContent = (ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--') + ' bpm';
    document.getElementById('val-intensidad').innerHTML = '<span style="color:#56d364">ESTADO ACTUALIZADO ✓</span>';

    // 3. Preparar Datos para los Gráficos (Últimos 14 días)
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

    // 4. Renderizar Gráficos (Chart.js)
    Chart.defaults.color = '#666'; 
    Chart.defaults.borderColor = '#1a1a1a'; 
    Chart.defaults.font.family = "'Consolas', monospace"; 
    
    const baseOptions = { responsive: true, maintainAspectRatio: false };

    new Chart(document.getElementById('canvasFisiologia').getContext('2d'), { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'HRV', data: dataHRV, borderColor: '#555', backgroundColor: 'rgba(85,85,85,0.1)', fill: true, tension: 0.1 }, 
                { label: 'RHR', data: dataRHR, borderColor: '#ff2a2a', backgroundColor: 'rgba(255,42,42,0.1)', fill: true, tension: 0.1 }
            ]
        }, 
        options: baseOptions 
    });

    new Chart(document.getElementById('canvasEsfuerzo').getContext('2d'), { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'Fitness (CTL)', data: dataFitness, borderColor: '#ff8800', backgroundColor: 'rgba(255,136,0,0.05)', fill: true, tension: 0.1, yAxisID: 'y' }, 
                { label: 'Impacto', data: dataCarga, type: 'bar', backgroundColor: 'rgba(255,42,42,0.3)', borderColor: '#ff2a2a', borderWidth: 1, yAxisID: 'y1' }
            ]
        }, 
        options: { 
            ...baseOptions, 
            scales: { 
                y: { position: 'left' }, 
                y1: { grid: { drawOnChartArea: false }, position: 'right' } 
            } 
        } 
    });
}

// ============================================================================
// 4. INTELIGENCIA ARTIFICIAL (Gemini API Local)
// ============================================================================
async function llamarGemini(prompt) {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.geminiKey) throw new Error('Falta la clave API de Gemini en Configuración.');
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiKey}`;
    
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if (!res.ok) throw new Error(`Error API Gemini: ${res.status}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function extraerEtiqueta(texto, tag) {
    const ETIQUETAS = 'RESUMEN_CORTO|ANALISIS_RETROSPECTIVO|ANALISIS_PRESCRIPCION|CALENTAMIENTO|PRINCIPAL|ENFRIAMIENTO|TIPO_DIETA|MACRO_CARBOS|MACRO_PROTES|MACRO_GRASAS|CONSEJO_NUTRICIONAL';
    const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)(?=\\[(?:${ETIQUETAS})\\]|$)`);
    const match = texto.match(re);
    return match ? match[1].trim() : '---';
}

async function solicitarEntrenamientoIA() {
    const btn = document.getElementById('btn-generar-ia');
    const containerSesion = document.getElementById('contenedor-sesion-prescrita');
    const containerAnalisis = document.getElementById('contenedor-analisis-ia');
    
    if (btn) btn.style.display = 'none';
    containerAnalisis.innerHTML = '<p style="color:#ff8800; font-family:\'Consolas\', monospace;">Conectando con A.R.G.O.S. IA... Calculando matrices.</p>';
    
    try {
        const config = await DB.get('config', 'credenciales');
        const nombreAtleta = config?.nombre || 'Atleta';
        
        const lesiones = document.getElementById('texto-lesiones').value || 'Ninguna lesión activa.';
        const hrvActual = document.getElementById('ticker-hrv').textContent;
        const formActual = document.getElementById('val-fatiga').innerText; // TSB

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
        const calentamiento = extraerEtiqueta(respuestaIA, 'CALENTAMIENTO');
        const principal = extraerEtiqueta(respuestaIA, 'PRINCIPAL');
        const enfriamiento = extraerEtiqueta(respuestaIA, 'ENFRIAMIENTO');
        const nutricion = extraerEtiqueta(respuestaIA, 'CONSEJO_NUTRICIONAL');

        containerAnalisis.innerHTML = `<p>${analisis}</p>`;
        
        containerSesion.innerHTML = `
            <div class="seccion-ruta"><div class="tag-ruta">Calentamiento</div>${calentamiento}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Principal</div>${principal}</div>
            <div class="seccion-ruta"><div class="tag-ruta">Enfriamiento</div>${enfriamiento}</div>
        `;

        document.getElementById('val-nutricion-consejo').textContent = nutricion;

    } catch (error) {
        containerAnalisis.innerHTML = `<p style="color:#ff2a2a;">Fallo en el núcleo IA: ${error.message}</p>`;
        if (btn) btn.style.display = 'block';
    }
}

// ============================================================================
// 5. RUTINAS DE INICIO Y BINDING DE UI
// ============================================================================
async function iniciarTelemetria() {
    try {
        const config = await DB.get('config', 'credenciales');
        if (!config || !config.intervalsKey) {
            document.getElementById('val-intensidad').innerHTML = '<span style="color:#ff8800">⚠️ Requiere Configuración</span>';
            document.getElementById('val-fatiga').innerHTML = '<span style="color:#ff8800">Inserta tus claves en la pestaña Configuración.</span>';
            return;
        }

        document.getElementById('val-intensidad').textContent = 'Extrayendo telemetría...';
        document.getElementById('val-fatiga').textContent = 'Calculando equilibrio...';
        
        const datosIntervals = await fetchIntervalsData();
        procesarYDibujarMetricas(datosIntervals);

    } catch (error) {
        console.error(error);
        document.getElementById('val-intensidad').innerHTML = `<span style="color:#ff2a2a">Error: ${error.message}</span>`;
        document.getElementById('val-fatiga').innerHTML = `<span style="color:#ff2a2a">Revisa tus credenciales.</span>`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('header-fecha').textContent = hoy;

    try {
        await initDB();
        await cargarConfiguracion();
        document.getElementById('btn-guardar-config').addEventListener('click', guardarConfiguracion);
        
        // Iniciar telemetría
        await iniciarTelemetria();

        // Inyectar botón de Inteligencia Artificial si hay conexión
        const config = await DB.get('config', 'credenciales');
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
        alert("Fallo crítico en el sistema de almacenamiento. Comprueba los permisos de tu navegador.");
    }
});
