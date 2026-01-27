const QRCode = require('qrcode');
const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

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

const PALABRAS_CLAVE = [
    'reprogramacion',
    'reprogramación',
    'cancelacion',
    'chat de expertos',
    'actualizacion de caja',
    'retiren cmo',
    'sofclofe'
];

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
    console.log(`🌐 Servidor web activo en puerto ${PORT}`);
});

// ───────────────── BASE PATH (CRÍTICO PARA EXE) ─────────────────
const BASE_PATH = path.join(
    process.env.APPDATA || process.cwd(),
    'BotWhatsAppNicol'
);

if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH, { recursive: true });
}

const PATH_STORE = path.join(
    BASE_PATH,
    'mensajes_store.json'
);

// ───────────────── CLIENTE ─────────────────
const SESSION_PATH = '/data/session';

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH
    }),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: 'new',
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--single-process',
            '--no-zygote'
        ]
    }
});

// ───────────────── STORE PERSISTENTE ─────────────────
let store = { porMensaje: {}, porCta: {} };

function cargarStore() {
    try {
        if (fs.existsSync(PATH_STORE)) {
            store = JSON.parse(fs.readFileSync(PATH_STORE));
        }
    } catch {
        store = { porMensaje: {}, porCta: {} };
    }
}

function guardarStore() {
    fs.writeFileSync(PATH_STORE, JSON.stringify(store, null, 2));
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

    // ⚠️ NO se limpia aquí
    // El SLA depende de este registro
}

// ───────────────── QR Y READY ─────────────────
client.on('qr', async (qr) => {
    try {
        lastQrDataUrl = await QRCode.toDataURL(qr);
        console.log('📲 QR generado y disponible vía web');
    } catch (err) {
        console.error('❌ Error generando QR', err);
    }
});
client.on('ready', () => console.log('🚀 BOT FINAL - LISTO PARA PRODUCCIÓN'));

// ───────────────── MENSAJES ─────────────────
client.on('message_create', async (msg) => {
    if (msg.fromMe) return;

    try {
        const chat = await msg.getChat();
        const origen = chat.id._serialized;

        const texto = msg.hasMedia
            ? (msg.caption || '')
            : (msg.body || '');

        if (RUTAS_INTERMEDIARIOS[origen]) {

            if (!detectarPlantilla(texto, msg)) {
                await msg.reply(
                    '⚠️ Solicitud incompleta o no explícita.\n' +
                    'Por favor valida la plantilla y vuelve a enviar.'
                );
                return;
            }

            const grupoIntermediario = RUTAS_INTERMEDIARIOS[origen];

            const autorId = msg.author || msg.from;
            const contacto = await client.getContactById(autorId);
            const nombre = contacto.pushname || 'Técnico';

            const matchCta =
                texto.match(/CTA.*[:\s](\d{6,})/i) ||
                texto.match(/(\d{7,10})/);

            const cta = matchCta ? (matchCta[1] || matchCta[0]) : null;

            let enviado;

            if (msg.hasMedia) {
                const media = await msg.downloadMedia();

                enviado = await client.sendMessage(
                    grupoIntermediario,
                    media,
                    {
                        caption: `${texto}\n\n_me ayudas con esto porfavor_`,
                        sendSeen: false
                    }
                );
            } else {
                enviado = await client.sendMessage(
                    grupoIntermediario,
                    `${texto}\n\n_me ayudas con esto porfavor_`,
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

        if (!RUTAS_INTERMEDIARIOS[origen]) {
            const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;
            const datos = resolverReferencia(quoted?.id._serialized, texto);

            if (datos && datos.atendido === false) {
                datos.atendido = true;
                guardarStore();
            }
        }

    } catch (err) {
        if (!err.message.includes('markedUnread')) {
            console.error(err.message);
        }
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
});

// ───────────────── SLA MONITOR ─────────────────
require('./slaMonitor')(client, PATH_STORE);

// ───────────────── START ─────────────────

client.initialize();
