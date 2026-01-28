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
    '120363424034037857@g.us': '120363421788879642@g.us'
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

// ───────────────── BASE PATH ─────────────────
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

// ───────────────── VALIDADORES ─────────────────
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
    return validarReprogramacion(texto) ||
           validarNoContacto(texto, msg) ||
           validarNoDeseaServicio(texto) ||
           validarDatosErrados(texto) ||
           validarSolicitudGeneral(texto);
}

// ───────────────── MOTOR ÚNICO ─────────────────
function resolverReferencia(msgId, texto) {
    if (msgId && store.porMensaje[msgId]) return store.porMensaje[msgId];

    const match = texto?.match(/(\d{7,10})/);
    if (match && store.porCta[match[0]]) return store.porCta[match[0]];

    return null;
}

// ───────────────── RESPUESTA ─────────────────
async function responderTecnico(datos) {
    const formato = `✅ *RESPUESTA PARA @${datos.nombre.toUpperCase()}:*\n\nESCALADO ⚠️`;
    await client.sendMessage(datos.grupo, formato, { sendSeen: false });
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
    if (msg.fromMe && !msg.hasQuotedMsg) return;

    try {
        const chat = await msg.getChat();
        const origen = chat.id._serialized;

        const textoOriginal = msg.hasMedia ? (msg.caption || '') : (msg.body || '');
        const textoNormalizado = textoOriginal.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

        if (RUTAS_INTERMEDIARIOS[origen]) {
            if (!detectarPlantilla(textoNormalizado, msg)) {
                await msg.reply('⚠️ Solicitud incompleta o no explícita.');
                return;
            }

            const grupoIntermediario = RUTAS_INTERMEDIARIOS[origen];
            const autorId = msg.author || msg.from;
            const contacto = await client.getContactById(autorId);
            const nombre = contacto.pushname || 'Técnico';

            let enviado;
            if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                enviado = await client.sendMessage(grupoIntermediario, media, {
                    caption: `${textoOriginal}\n\n_me ayudas con esto porfavor_`,
                    sendSeen: false
                });
            } else {
                enviado = await client.sendMessage(
                    grupoIntermediario,
                    `${textoOriginal}\n\n_me ayudas con esto porfavor_`,
                    { sendSeen: false }
                );
            }

            store.porMensaje[enviado.id._serialized] = {
                grupo: origen,
                autor: autorId,
                nombre,
                grupoIntermediario,
                timestampEnvio: Date.now(),
                recordatoriosEnviados: 0,
                atendido: false
            };

            guardarStore();
            await responderTecnico(store.porMensaje[enviado.id._serialized]);
        }

    } catch (err) {
        console.error('❌ [MSG ERROR]', err);
    }
});

// ───────────────── SLA ─────────────────
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
}, 30000);
