const fs = require('fs');

// ───────────────── SLA MONITOR ─────────────────
module.exports = function iniciarSlaMonitor(client, PATH_STORE) {

    // ───────────────── CONFIGURACIÓN SLA ─────────────────

    // Intervalo de verificación (1 minuto)
    const INTERVALO_VERIFICACION_MS = 60 * 1000;

    // Tiempo entre recordatorios (15 minutos)
    const TIEMPO_RECORDATORIO_MS = 15 * 60 * 1000;

    // Máximo de recordatorios por solicitud
    const MAX_RECORDATORIOS = 2;

    // Mensaje oficial de recordatorio
    const TEXTO_RECORDATORIO =
        '⏰ Aún no se ha gestionado la solicitud.\n¿Me ayudas por favor?';

    // ───────────────── UTILIDADES STORE ─────────────────
    function cargarStore() {
        try {
            if (fs.existsSync(PATH_STORE)) {
                return JSON.parse(fs.readFileSync(PATH_STORE));
            }
        } catch {
            return { porMensaje: {}, porCta: {} };
        }
        return { porMensaje: {}, porCta: {} };
    }

    function guardarStore(store) {
        fs.writeFileSync(PATH_STORE, JSON.stringify(store, null, 2));
    }

    // ───────────────── SLA MONITOR ─────────────────
    setInterval(async () => {
        const store = cargarStore();
        const ahora = Date.now();
        let huboCambios = false;

        for (const mensajeId in store.porMensaje) {
            const datos = store.porMensaje[mensajeId];

            // Compatibilidad defensiva con registros viejos
            if (!datos.timestampEnvio) {
                datos.timestampEnvio = ahora;
                datos.recordatoriosEnviados = 0;
                datos.atendido = false;
                huboCambios = true;
                continue;
            }

            if (datos.atendido === true) continue;
            if (datos.recordatoriosEnviados >= MAX_RECORDATORIOS) continue;

            const tiempoTranscurrido = ahora - datos.timestampEnvio;
            const siguienteRecordatorio =
                TIEMPO_RECORDATORIO_MS * (datos.recordatoriosEnviados + 1);

            if (tiempoTranscurrido < siguienteRecordatorio) continue;

            try {
                // 🔑 Obtenemos el mensaje ORIGINAL (texto o media)
                const mensajeOriginal = await client.getMessageById(mensajeId);
                if (!mensajeOriginal) continue;

                const chat = await mensajeOriginal.getChat();
                if (!chat) continue;

                // 🔁 Reply directo al mensaje original (seguro para caption/media)
                await chat.sendMessage(TEXTO_RECORDATORIO, {
                    quotedMessageId: mensajeOriginal.id._serialized,
                    sendSeen: false
                });

                datos.recordatoriosEnviados += 1;
                huboCambios = true;

            } catch {
                // Silencioso por diseño: nunca rompemos producción
            }
        }

        if (huboCambios) {
            guardarStore(store);
        }

    }, INTERVALO_VERIFICACION_MS);
};
