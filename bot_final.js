const QRCode = require('qrcode');
const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

console.log('🟢 [BOOT] Archivo iniciado');

// ───────────────── CONFIGURACIÓN ─────────────────
const ID_TECNICOS_LAB = '120363424034037857@g.us';
const ID_TABASCO_LAB = '120363421788879642@g.us';

let lastQrDataUrl = null;

// ── RUTEO DEFINITIVO DE GRUPOS ──
const RUTAS_INTERMEDIARIOS = {
    '120363401821218041@g.us': '120363342030232133@g.us',
    '120363318168278146@g.us': '120363268978891285@g.us',
    '120363401456951971@g.us': '120363268978891285@g.us'
};

console.log('🧭 [CONFIG] Rutas:', Object.keys(RUTAS_INTERMEDIARIOS));

const PALABRAS_CLAVE = [
    'reprogramacion',
    'reprogramación',
    'cancelacion',
    'chat de expertos',
    'actualizacion de caja',
    'retiren cmo',
    'sofclofe'
];

// ───────────────── SERVIDOR WEB ─────────────────
const PORT = 8080;
http.createServer((req, res) => {
    if (req.url === '/qr') {
        if (!lastQrDataUrl) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('QR no disponible aún');
        }

        const img = lastQrDataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(img, 'base64');

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': buffer.length
        });
        return res.end(buffer);
    }

    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            ready: !!client.info
        }));
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot WhatsApp activo');
}).listen(PORT, () => {
    console.log(`🌐 [HTTP] Servidor web activo en puerto ${PORT}`);
});

// ───────────────── BASE PATH (CORREGIDO PARA RAILWAY) ─────────────────
const BASE_PATH = '/data';

if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH, { recursive: true });
}

const PATH_STORE = path.join(BASE_PATH, 'mensajes_store.json');
console.log('📁 [PATH] Store:', PATH_STORE);

// ───────────────── CLIENTE ─────────────────
console.log('🤖 [CLIENT] Creando cliente WhatsApp');

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: '/data/session',
    clientId: 'milenium-bot'
  }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});
// ───────────────── STORE PERSISTENTE ─────────────────
let store = { porMensaje: {}, porCta: {} };

function cargarStore() {
    try {
        if (fs.existsSync(PATH_STORE)) {
            store = JSON.parse(fs.readFileSync(PATH_STORE));
            console.log('📦 [STORE] Cargado');
        } else {
            console.log('📦 [STORE] No existe, inicial vacío');
        }
    } catch (err) {
        console.error('❌ [STORE] Error cargando:', err.message);
        store = { porMensaje: {}, porCta: {} };
    }
}

function guardarStore() {
    fs.writeFileSync(PATH_STORE, JSON.stringify(store, null, 2));
    console.log('💾 [STORE] Guardado');
}

cargarStore();

// ───────────────── VALIDADORES DE PLANTILLAS ─────────────────
function validarSolicitudGeneral(texto) {
    return /(cta|#\s*cta)/i.test(texto) &&
           /(ot|lls)/i.test(texto) &&
           /solicitud/i.test(texto);
}

function validarReprogramacion(texto) {
    return /(cta|#\s*cta)/i.test(texto) &&
           /(ot|lls)/i.test(texto) &&
           /fecha.*actual/i.test(texto) &&
           /fecha.*reprogram/i.test(texto) &&
           /persona.*confirma/i.test(texto) &&
           /\b3\d{9}\b/.test(texto) &&
           /motivo/i.test(texto);
}

function validarDatosErrados(texto) {
    return /(cta|#\s*cta)/i.test(texto) &&
           /(ot|lls)/i.test(texto) &&
           /fecha.*agenda/i.test(texto) &&
           /persona.*confirma/i.test(texto) &&
           /\b3\d{9}\b/.test(texto) &&
           /observacion/i.test(texto);
}

function validarNoContacto(texto, msg) {
    return /(cta|#\s*cta)/i.test(texto) &&
           /(ot|lls)/i.test(texto) &&
           /fecha.*agenda/i.test(texto) &&
           /tecnico/i.test(texto) &&
           /fachada/i.test(texto) &&
           msg.hasMedia === true;
}

function validarNoDeseaServicio(texto) {
    return /(cta|#\s*cta)/i.test(texto) &&
           /(ot|lls)/i.test(texto) &&
           /fecha.*agenda/i.test(texto) &&
           /persona.*confirma/i.test(texto) &&
           /\b3\d{9}\b/.test(texto) &&
           /motivo/i.test(texto);
}

function detectarPlantilla(texto, msg) {
    if (validarReprogramacion(texto)) return true;
    if (validarNoContacto(texto, msg)) return true;
    if (validarNoDeseaServicio(texto)) return true;
    if (validarDatosErrados(texto)) return true;
    if (validarSolicitudGeneral(texto)) return true;
    return false;
}

// ───────────────── MOTOR ÚNICO ─────────────────
function resolverReferencia(msgId, texto) {
    if (msgId && store.porMensaje[msgId]) {
        return store.porMensaje[msgId];
    }

    const match = texto?.match(/(\d{7,10})/);
    if (match && store.porCta[match[0]]) {
        return store.porCta[match[0]];
    }

    return null;
}

// ───────────────── RESPUESTA ÚNICA ─────────────────
async function responderTecnico(datos) {
    const formato = `✅ *RESPUESTA PARA @${datos.nombre.toUpperCase()}:*\n\nESCALADO ⚠️`;

    await client.sendMessage(datos.grupo, formato, {
        sendSeen: false
    });
}

// ───────────────── QR Y READY ─────────────────
client.on('qr', async (qr) => {
    lastQrDataUrl = await QRCode.toDataURL(qr);
    console.log('📲 [QR] Generado');
});

client.on('ready', () => {
    console.log('🚀 BOT FINAL - LISTO PARA PRODUCCIÓN');
});

// ───────────────── MENSAJES ─────────────────
client.on('message_create', async (msg) => {
    console.log('📩 [MSG] Recibido');

    // Nunca procesar mensajes enviados por el bot
    if (msg.fromMe) return;

    try {
        const chat = await msg.getChat();
        const origen = chat.id._serialized;
        console.log('📍 [MSG] Grupo:', origen);

        // ── TEXTO ORIGINAL (SE USA PARA REENVÍO) ──
        const textoOriginal = msg.hasMedia
            ? (msg.caption || '')
            : (msg.body || '');

        console.log('📝 [MSG] Texto original:', textoOriginal);

        // ── TEXTO NORMALIZADO (SOLO PARA VALIDACIÓN) ──
        const textoNormalizado = textoOriginal
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        console.log('🧹 [MSG] Texto normalizado:', textoNormalizado);

        // ───────────────── RUTEO DESDE TÉCNICOS ─────────────────
        if (RUTAS_INTERMEDIARIOS[origen]) {
            console.log('➡️ [RUTEO] Grupo técnico');

            // ❌ Validación estricta: UN SOLO MENSAJE
            if (!detectarPlantilla(textoNormalizado, msg)) {
                console.log('❌ [PLANTILLA] Inválida');
                await msg.reply(
                    '⚠️ Solicitud incompleta o no explícita.\n' +
                    'Por favor valida la plantilla y vuelve a enviar.'
                );
                return;
            }

            console.log('✅ [PLANTILLA] Válida');

            const grupoIntermediario = RUTAS_INTERMEDIARIOS[origen];
            console.log('🎯 [RUTEO] Enviando a:', grupoIntermediario);

            const autorId = msg.author || msg.from;
            const contacto = await client.getContactById(autorId);
            const nombre = contacto.pushname || 'Técnico';

            const matchCta =
                textoNormalizado.match(/CTA.*[:\s](\d{6,})/i) ||
                textoNormalizado.match(/(\d{7,10})/);

            const cta = matchCta ? (matchCta[1] || matchCta[0]) : null;

            let enviado;

            if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                enviado = await client.sendMessage(
                    grupoIntermediario,
                    media,
                    {
                        caption: `${textoOriginal}\n\n_me ayudas con esto porfavor_`,
                        sendSeen: false
                    }
                );
            } else {
                enviado = await client.sendMessage(
                    grupoIntermediario,
                    `${textoOriginal}\n\n_me ayudas con esto porfavor_`,
                    { sendSeen: false }
                );
            }

            const datos = {
                grupo: origen,
                autor: autorId,
                nombre,
                cta,
                grupoIntermediario,
                timestampEnvio: Date.now(),
                recordatoriosEnviados: 0,
                atendido: false
            };

            store.porMensaje[enviado.id._serialized] = datos;
            if (cta) store.porCta[cta] = datos;

            guardarStore();
            await responderTecnico(datos);
        }

        // ───────────────── RESPUESTAS DESDE MILENIUM ─────────────────
        if (!RUTAS_INTERMEDIARIOS[origen]) {
            const quoted = msg.hasQuotedMsg
                ? await msg.getQuotedMessage()
                : null;

            const datos = resolverReferencia(
                quoted?.id._serialized,
                textoNormalizado
            );

            if (datos && datos.atendido === false) {
                datos.atendido = true;
                guardarStore();
            }
        }

    } catch (err) {
        console.error('❌ [MSG ERROR]', err.message);
    }
});


// ───────────────── REACCIONES ─────────────────
client.on('message_reaction', async (reaction) => {
    try {
        const mensajeId = reaction.msgId?._serialized;
        if (!mensajeId) return;

        const datos = store.porMensaje[mensajeId];
        if (datos && datos.atendido === false) {
            datos.atendido = true;
            guardarStore();
        }
    } catch {}
});

// ───────────────── PROTECCIÓN BUGS ─────────────────
process.on('unhandledRejection', (err) => {
    if (err?.message?.includes('markedUnread')) return;
    console.error('❌ UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
});

// ───────────────── SLA MONITOR ─────────────────
require('./slaMonitor')(client, PATH_STORE);

// ───────────────── START ─────────────────
console.log('🟢 [START] Inicializando cliente WhatsApp');
client.initialize();

// ───────────────── HEALTHCHECK ─────────────────
setInterval(() => {
    console.log(client.info
        ? '✅ [HEALTH] WhatsApp conectado'
        : '⏳ [HEALTH] WhatsApp no conectado'
    );
}, 1000 * 30);
