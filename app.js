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
// 3. COMUNICACIONES EXTERNAS (Interfaces API)
// ============================================================================

// Llamada a Intervals.icu directa desde el navegador
async function fetchIntervals() {
    const config = await DB.get('config', 'credenciales');
    if (!config || !config.athleteId || !config.intervalsKey) {
        throw new Error('Faltan credenciales de Intervals. Ve a Configuración.');
    }

    const token = btoa('API_KEY:' + config.intervalsKey);
    const headers = { 'Authorization': `Basic ${token}` };
    
    // Calculamos fechas tácticas (Últimos 14 días)
    const hoy = new Date();
    const hace14Dias = new Date();
    hace14Dias.setDate(hoy.getDate() - 14);
    
    const strHoy = hoy.toISOString().split('T')[0];
    const strInicio = hace14Dias.toISOString().split('T')[0];

    const url = `https://intervals.icu/api/v1/athlete/${config.athleteId}/wellness?oldest=${strInicio}&newest=${strHoy}`;
    
    console.log('[Obi-Wan] Contactando con satélites de Intervals...');
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
    return await res.json();
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
        
        // Aquí conectamos con la API
        const wellnessData = await fetchIntervals();
        
        // Lógica simplificada de comprobación para verificar que la conexión vive
        if (wellnessData && wellnessData.length > 0) {
            const ultimoRegistro = wellnessData[wellnessData.length - 1];
            document.getElementById('ticker-hrv').textContent = ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--';
            document.getElementById('ticker-rhr').textContent = ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--';
            document.getElementById('card-hrv-val').textContent = (ultimoRegistro.hrv ? Math.round(ultimoRegistro.hrv) : '--') + ' ms';
            document.getElementById('card-rhr-val').textContent = (ultimoRegistro.restingHR ? Math.round(ultimoRegistro.restingHR) : '--') + ' bpm';
            
            document.getElementById('val-intensidad').innerHTML = '<span style="color:#56d364">CONEXIÓN ESTABLECIDA ✓</span>';
            document.getElementById('val-fatiga').innerHTML = `<span style="color:#79c0ff">Sincronizado hoy.<br><small>CTL: ${Math.round(ultimoRegistro.ctl || 0)}</small></span>`;
        } else {
            document.getElementById('val-intensidad').textContent = 'No hay datos recientes en el reloj.';
        }

    } catch (error) {
        console.error(error);
        document.getElementById('val-intensidad').innerHTML = `<span style="color:#ff2a2a">Error de enlace: ${error.message}</span>`;
    }
}

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