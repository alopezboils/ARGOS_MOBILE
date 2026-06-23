// app.js - A.R.G.O.S. Motor Lógico Local (PWA)
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
            
            // Tabla de Configuración (Claves API, Nombre)
            if (!database.objectStoreNames.contains('config')) {
                database.createObjectStore('config', { keyPath: 'id' });
            }
            // Tabla de Bitácora (Entrenamientos y Sensaciones)
            if (!database.objectStoreNames.contains('bitacora')) {
                database.createObjectStore('bitacora', { keyPath: 'fecha' });
            }
            // Tabla de Fotografías y Nutrición
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

// Funciones de ayuda táctica para leer/escribir en IndexedDB
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
        
        // Refrescar datos tras guardar claves
        iniciarTelemetria();
    } catch (error) {
        btn.textContent = '❌ ERROR AL GUARDAR';
        btn.style.background = '#ff2a2a';
    }
}

// ============================================================================
// 3. COMUNICACIONES Y CÁLCULO FISIOLÓGICO
// ============================================================================

async function fetchIntervalsData() {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.athleteId || !config.intervalsKey) {
        throw new Error('Faltan credenciales de Intervals.');
    }

    const token = btoa('API_KEY:' + config.intervalsKey);
    const headers = { 'Authorization': `Basic ${token}` };
    
    // Rango táctico: Últimos 14 días para una imagen clara
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
    const labels = wellness.map(d => d.id.slice(5)); // DD-MM
    const dataHRV = wellness.map(d => d.hrv || null);
    const dataRHR = wellness.map(d => d.restingHR || null);
    const dataFitness = wellness.map(d => d.ctl || null);
    
    // Agrupar carga de actividades por día
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
// 4. RUTINAS DE INICIO Y BINDING DE UI
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

// Evento principal
document.addEventListener('DOMContentLoaded', async () => {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('header-fecha').textContent = hoy;

    try {
        await initDB();
        await cargarConfiguracion();
        document.getElementById('btn-guardar-config').addEventListener('click', guardarConfiguracion);
        await iniciarTelemetria();
    } catch (e) {
        alert("Fallo crítico en el sistema de almacenamiento. Comprueba los permisos de tu navegador.");
    }
});

// Evento principal: Cuando la página carga
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Poner fecha de hoy en la cabecera
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('header-fecha').textContent = hoy;

    // 2. Levantar los escudos de la Base de Datos
    try {
        await initDB();
        await cargarConfiguracion();
        
        // Bindings de botones
        document.getElementById('btn-guardar-config').addEventListener('click', guardarConfiguracion);
        
        // 3. Iniciar secuencia de conexión
        await iniciarTelemetria();
        
    } catch (e) {
        alert("Fallo crítico en el sistema de almacenamiento del navegador. Asegúrate de no estar en modo incógnito estricto.");
    }
});
