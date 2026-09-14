/**
 * Telemetry - Reporta uso de contenido (canal/VOD/catchup) al backend de
 * panaccess vía la operación SOAP "cvPushTelemetryRecords", usando el mismo
 * puente HTTP que ya usa el resto de la app (cv.get_result_post con
 * requestMode=function&f=pushTelemetryRecords).
 *
 * FIX (2026-09-03): el backend devolvía fatal_error/"Unhandeld error" al
 * reportar cambios de canal en vivo. Causa: se mandaba actionId 5/6
 * (SWITCHED_TO/AWAY_FROM_SERVICE) con datos de STREAM (serviceId/serviceName
 * apuntando al streamId real). Según TelemetryRecords.java (SDK Android,
 * referencia autoritativa) 5/6 son específicamente para sintonía de servicio
 * Multicast/DVB (tuner real, netId/tsId) -- esta app sirve TODO el contenido
 * en vivo por HLS/OTT vía CDN (ver cv.getAvailableStreams), nunca DVB real,
 * así que el par correcto es 7/8 (SWITCHED_TO/AWAY_FROM_STREAM) con
 * streamId/streamName. Corregido acá (antes: ACTION.SWITCHED_TO_SERVICE/
 * SWITCHED_AWAY_FROM_SERVICE + campos serviceId/serviceName).
 *
 * Es la contraparte, en este proyecto Tizen/webOS (sin Activity/Handler/
 * File real), del módulo TelemetryRecords.java del SDK Android de
 * panaccess. Mismas constantes de acción/razón y mismos límites (100
 * registros por llamada, 30s mínimo entre llamadas), pero:
 *   - Persistencia local: localStorage (array JSON) en vez de archivos
 *     rotados en disco.
 *   - "Acción en curso" en memoria (con timer de tiempo mínimo antes de
 *     confirmarla) en vez de guardarla a disco para sobrevivir un reinicio
 *     de la app -- si la app se cierra a mitad de una acción, esa acción
 *     puntual se pierde (no el resto del historial pendiente de envío, que
 *     sí sigue en localStorage). Aceptable para una v1; si hace falta
 *     sobrevivir cierres abruptos, se puede persistir "current" también.
 *
 * VALIDADO contra TelemetryRecords.java / sendTelemetryRecords() reales (no
 * solo contra el WSDL) -- dos correcciones aplicadas acá como resultado:
 *   - reasonId de VOD_FINISHED/CATCHUP_FINISHED: se manda siempre
 *     USER_INTERACTION_REASON (1). VOD_ENDED_REASON(3)/CATCHUP_ENDED_REASON(4)
 *     existen como constantes en Android pero NO se usan en ninguna llamada
 *     real del .java -- storeVodFinishedAction()/storeCatchupFinishedAction()
 *     mandan USER_INTERACTION_REASON igual que el resto. Antes este módulo
 *     mandaba 3/4 asumiendo que se usaban; se corrigió.
 *   - Momento de encolar el registro de "inicio" en VOD/catchup: Android
 *     (storeVodOrCatchupStartedRunnable) lo manda apenas se cumple el tiempo
 *     mínimo, sin esperar a que termine el contenido. Antes este módulo
 *     esperaba al final para encolar inicio+fin juntos (para "service" sigue
 *     siendo así, que es como realmente se comporta Android para ese caso --
 *     ver comentario en beginCurrent/endCurrent).
 *
 * SUPUESTOS que siguen sin poder confirmarse solo leyendo el código fuente
 * (requieren una llamada real contra el backend o un getClientConfig de
 * ejemplo para chequear):
 *   - Formato de "date"/"timestamp": se manda como string ISO-8601
 *     ("YYYY-MM-DD" / ISO completo). El WSDL los tipa como xsd:date/
 *     xsd:dateTime pero no dice el formato que espera el puente JSON. Además,
 *     Android puede mandar estos campos en null si ClientConfigSettings dice
 *     que la telemetría no debe registrar mes/fecha exacta -- este proyecto
 *     no tiene ningún flag equivalente en el config que devuelve
 *     cv.getClientConfig (revisado: no aparece nada tipo "telemetry" ahí),
 *     así que no hay de dónde leerlo.
 *   - "anonymize": se manda fijo en false. Android lo lee de
 *     ClientConfigSettings (un flag que vendría de getClientConfig); mismo
 *     caso que arriba, no hay flag equivalente disponible en este proyecto.
 *   - "profileId": no se manda (Android tampoco lo pasaba en ninguna de
 *     las llamadas vistas en TelemetryRecords.java).
 *   - Nombre del parámetro HTTP con los registros: este proyecto manda
 *     "records" (ver cv.pushTelemetryRecords). El sendTelemetryRecords()
 *     de Android arma el HashMap con la clave "recordsJson". Son bridges
 *     distintos (CasFunctionCaller vs. el bridge JSON genérico de esta app)
 *     así que no es necesariamente el mismo contrato, pero si el backend
 *     rechaza/ignora los registros silenciosamente, este nombre de campo es
 *     lo primero a comparar contra el WSDL real.
 *   - "smartcardId": Android SIEMPRE lo manda (license key en mobile, serial
 *     de la box si no). Acá nunca se pasa (justificado: app solo streaming
 *     OTT, sin smartcard/CI+) -- válido si el campo es opcional en el WSDL,
 *     pendiente de confirmar si no.
 *   - Retry tras error: acá 5 minutos (RETRY_AFTER_ERROR_DELAY), Android usa
 *     1 hora. Simplificación intencional, no corregida (reintentar más
 *     rápido no debería romper nada del lado servidor, pero es una
 *     divergencia real a tener presente).
 *   - PERIODIC_FLUSH_INTERVAL sigue en 10 minutos "temporal para pruebas" --
 *     falta volver a 2*60*60*1000 (valor real de producción en Android)
 *     antes de salir a producción.
 */
var Telemetry = (function () {
  var Telemetry = {};

  // ============================================
  // CONSTANTES (mismos valores que TelemetryRecords.java)
  // ============================================
  var ACTION = {
    // 7/8, no 5/6: ver nota "FIX (2026-09-03)" en la cabecera del archivo.
    SWITCHED_TO_STREAM: 7,
    SWITCHED_AWAY_FROM_STREAM: 8,
    VOD_STARTED: 13,
    VOD_STOPPED_PREMATURELY: 14,
    VOD_FINISHED: 15,
    CATCHUP_STARTED: 16,
    CATCHUP_STOPPED_PREMATURELY: 17,
    CATCHUP_FINISHED: 18
  };

  var REASON = {
    USER_INTERACTION: 1,
    VOD_ENDED: 3,
    CATCHUP_ENDED: 4
  };

  var MIN_TIME = {
    service: 60 * 1000,  // 1 minuto, igual que SWITCHED_TO_STREAM_MIN_TIME
    vod: 60 * 1000,          // 1 minuto, igual que VOD_STARTED_MIN_TIME
    catchup: 60 * 1000       // 1 minuto, igual que CATCHUP_STARTED_MIN_TIME
  };

  var MAX_RECORDS_PER_CALL = 100;              // límite duro del WSDL
  var MIN_MS_BETWEEN_CALLS = 30 * 1000;         // "wait 30 seconds between each call"
  var FIRST_FLUSH_DELAY = 25 * 1000;            // igual que TIME_TO_SEND_FIRST_TELEMETRY_REPORT
  var PERIODIC_FLUSH_INTERVAL = 10 * 60 * 1000; // TEMPORAL PARA PRUEBAS -- volver a 2*60*60*1000 en producción
  var RETRY_AFTER_ERROR_DELAY = 5 * 60 * 1000;  // simplificado respecto al 1h de Android

  var PENDING_STORAGE_KEY = "epg_telemetry_pending_v1";
  var MAX_PENDING_STORED = 500; // tope defensivo para no crecer sin límite si el envío falla mucho tiempo

  var TAG = "Telemetry";

  // ============================================
  // ESTADO
  // ============================================
  var enabled = true;           // si el backend rechaza la función (function_not_available), se apaga en memoria
  var initialized = false;
  var pending = [];              // registros ya confirmados, esperando ser enviados
  var current = null;            // acción "en curso" (aún no confirmada por tiempo mínimo)
  var sending = false;
  var flushTimer = null;
  var periodicTimer = null;

  // ============================================
  // UTILIDADES
  // ============================================
  function log(msg) {
    if (typeof console !== "undefined" && console.log) {
      console.log("[" + TAG + "] " + msg);
    }
  }

  function isoDate(d) {
    // "YYYY-MM-DD" -- ver nota de SUPUESTOS arriba
    return d.toISOString().slice(0, 10);
  }

  function isoDateTime(d) {
    return d.toISOString();
  }

  function loadPendingFromStorage() {
    try {
      var raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Sanitizar registros antiguos que tengan campos nulos o indefinidos incompatibles con el WSDL
      for (var i = 0; i < parsed.length; i++) {
        var rec = parsed[i];
        if (rec.actionKey === null) rec.actionKey = "";
        if (rec.reasonKey === null) rec.reasonKey = "";
        if (typeof rec.profileId === "undefined" || rec.profileId === null) rec.profileId = 0;
      }
      return parsed;
    } catch (e) {
      return [];
    }
  }

  function savePendingToStorage() {
    try {
      window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
    } catch (e) {
      log("No se pudo guardar en localStorage: " + e);
    }
  }

  var saveDebounceTimer = null;

  /**
   * enqueue() se llama DOS veces por cada cambio de canal/VOD/catchup
   * (registro de inicio + de fin), de forma sincrónica y en pleno
   * playContent() -- el camino más sensible a lag de toda la app. Guardar
   * en localStorage ahí mismo implica un JSON.stringify() de toda la cola
   * (hasta 500 registros) más I/O de storage, DOS veces, bloqueando el
   * cambio de canal. Se difiere unos milisegundos (y se colapsan llamadas
   * seguidas en un solo guardado) para que el guardado nunca compita con
   * la interacción del usuario.
   */
  function scheduleSaveToStorage() {
    if (saveDebounceTimer) return;
    saveDebounceTimer = setTimeout(function () {
      saveDebounceTimer = null;
      savePendingToStorage();
    }, 500);
  }

  function buildRecord(actionId, reasonId, dataObj) {
    return {
      anonymize: false, // SUPUESTO, ver cabecera del archivo
      date: isoDate(new Date()),
      timestamp: isoDateTime(new Date()),
      actionId: actionId,
      actionKey: "", // antes null -- el WSDL tipa esto como string (no opcional
      // como smartcardId), y el server devolvió fatal_error/unhandled;
      // string vacío es más seguro que null para el lado Java del bridge
      manual: true, // Android siempre manda true en toda llamada observada
      reasonId: reasonId,
      reasonKey: "", // idem actionKey
      data: JSON.stringify(dataObj || {}),
      profileId: 0 // el WSDL lo tipa int (no opcional); antes se omitía por completo
    };
  }

  function enqueue(actionId, reasonId, dataObj) {
    pending.push(buildRecord(actionId, reasonId, dataObj));
    if (pending.length > MAX_PENDING_STORED) {
      // Se pierden los más viejos antes que crecer sin límite si el envío
      // viene fallando hace mucho (mismo espíritu que el corte de 3 meses
      // en sendTelemetryReport() del lado Android).
      pending = pending.slice(pending.length - MAX_PENDING_STORED);
    }
    scheduleSaveToStorage();
    scheduleFlush(MIN_MS_BETWEEN_CALLS);
  }

  // ============================================
  // ENVÍO
  // ============================================
  function scheduleFlush(delay) {
    if (flushTimer) return; // ya hay un envío agendado, no duplicar
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, delay);
  }

  function flush() {
    // Estos returns silenciosos son la causa más común de "no veo nada en el
    // log": la cola/queue puede estar vacía (nada confirmado todavía, o ya se
    // vació en el envío anterior), o el flush puede estar bloqueado por algo
    // que no deja rastro salvo este log. Usar Telemetry.debugStatus() en la
    // consola para ver de un vistazo cuál de estos casos está pasando.
    if (!enabled) {
      log("flush() abortado: telemetría deshabilitada en memoria (el backend respondió function_not_available esta sesión)");
      return;
    }
    if (sending) {
      log("flush() abortado: ya hay un envío en curso");
      return;
    }
    if (!pending.length) {
      // No es un error -- simplemente no hay nada confirmado todavía para
      // mandar (ver umbrales de tiempo mínimo: 5 min para canal, 1 min para
      // VOD/catchup). No se loguea porque flush() se llama muy seguido
      // (cada 10 min por el timer periódico) y ensuciaría la consola.
      return;
    }

    if (typeof cv === "undefined" || typeof User === "undefined" || !User.getSessionId()) {
      // Todavía no hay sesión (ej. se dispara algo antes del login) -- reintentar más tarde
      log("flush() pospuesto: todavía no hay sesión (User.getSessionId() vacío)");
      scheduleFlush(MIN_MS_BETWEEN_CALLS);
      return;
    }

    sending = true;
    var batch = pending.slice(0, MAX_RECORDS_PER_CALL);

    log("Enviando " + batch.length + " registros de telemetría (quedan " + (pending.length - batch.length) + " en cola)");

    // La llamada real (armado de params + get_result_post) vive en cv.js,
    // igual que el resto de las operaciones contra el backend
    // (getBouquets, getCatchupGroups, recordOrDeleteCatchup, etc.) -- ver
    // cv.pushTelemetryRecords. Este módulo solo decide QUÉ y CUÁNDO enviar.
    //
    // FIX (2026-09-03): antes se mandaba `null` acá -- el backend
    // (cv.cablesatelite.com) devolvía fatal_error/"Unhandeld error" en TODOS
    // los intentos, con o sin los campos actionId 7/8 corregidos. Comparado
    // contra un proyecto hermano (appVideo, mismo backend Panaccess) que sí
    // funciona: la única diferencia real era que ese proyecto manda
    // `smartcardId` (ahí sacado de `userSession.getActiveLicense().licenseKey`)
    // y este nunca lo mandaba. El WSDL (cvPushTelemetryRecords) documenta
    // `smartcardId` como "(optional)", pero el backend de este cliente en la
    // práctica lo exige igual -- doc desactualizada respecto al comportamiento
    // real del servidor. `User.getLicense()` es el equivalente acá a
    // `getActiveLicense().licenseKey` de appVideo (ver `home.js` "AboutCard",
    // que muestra este mismo valor como la smartcard activa del usuario).
    cv.pushTelemetryRecords(batch, User.getLicense(), function (result) {
      sending = false;
      log("Telemetría enviada correctamente");
      pending = pending.slice(batch.length);
      savePendingToStorage();
      if (pending.length > 0) {
        scheduleFlush(MIN_MS_BETWEEN_CALLS);
      }
    }, function (result) {
      sending = false;
      log("Error enviando telemetría: " + JSON.stringify(result));
      if (result && result.errorCode === "function_not_available") {
        // El backend tiene la función deshabilitada para este cliente:
        // apagar en memoria para no seguir reintentando en vano esta sesión.
        enabled = false;
        return;
      }
      scheduleFlush(RETRY_AFTER_ERROR_DELAY);
    });
  }

  // ============================================
  // ACCIÓN "EN CURSO" (debounce por tiempo mínimo)
  // ============================================

  /**
   * Descarta o confirma la acción en curso (si hay una) y arranca una nueva.
   * @param {String} kind "service" | "vod" | "catchup"
   * @param {Object} startData datos ya listos para el campo "data" del registro de inicio
   */
  function beginCurrent(kind, startAction, startData) {
    // Si había algo en curso sin confirmar todavía (menos de su tiempo
    // mínimo), se descarta sin dejar ningún registro -- mismo criterio que
    // Android para no ensuciar el reporte con zapping rápido.
    if (current && current.timer) {
      clearTimeout(current.timer);
    }

    var minTime = MIN_TIME[kind] || 0;
    var entry = {
      kind: kind,
      startAction: startAction,
      startData: startData,
      startedAt: Date.now(),
      confirmed: minTime === 0,
      startSent: false, // true una vez que el registro de inicio ya se encoló
      timer: null
    };

    // Android trata distinto el momento de encolar el registro de INICIO
    // según el tipo de acción (visto en TelemetryRecords.java):
    //  - VOD/catchup: storeVodOrCatchupStartedRunnable llama a storeAction()
    //    apenas se cumple el tiempo mínimo -- el inicio se manda enseguida,
    //    sin esperar a que el contenido termine.
    //  - Servicio (switch de canal): el registro de inicio+fin se arma junto
    //    pero recién se escribe al archivo de salida cuando el usuario
    //    efectivamente cambia de canal (storeLastActionsFromMemory) -- ahí
    //    sí se comporta como acá (batched en endCurrent).
    // Replicamos esa asimetría: para vod/catchup encolamos el inicio ni bien
    // se confirma (mejor sobrevida ante un cierre abrupto -- si la app se
    // cierra a mitad de reproducción, al menos el "started" ya quedó en la
    // cola/localStorage); para "service" seguimos batcheando en endCurrent.
    if (minTime > 0) {
      entry.timer = setTimeout(function () {
        entry.confirmed = true;
        entry.timer = null;
        if (entry.kind === "vod" || entry.kind === "catchup") {
          enqueue(entry.startAction, REASON.USER_INTERACTION, entry.startData);
          entry.startSent = true;
        }
      }, minTime);
    } else if (kind === "vod" || kind === "catchup") {
      // minTime 0 (no debería pasar con los kinds actuales, pero por las dudas)
      enqueue(startAction, REASON.USER_INTERACTION, startData);
      entry.startSent = true;
    }

    current = entry;
  }

  /**
   * Cierra la acción en curso. Si sobrevivió el tiempo mínimo, encola el
   * registro de fin (con la duración real) y, si el de inicio todavía no se
   * había mandado (caso "service", ver beginCurrent), también encola el de
   * inicio en ese momento. Si no llegó a confirmarse, no encola nada.
   * @param {Object} opts { finished: Boolean, endAction, endReason, extraEndData }
   */
  function endCurrent(opts) {
    if (!current) return;

    if (current.timer) {
      clearTimeout(current.timer);
      current.timer = null;
    }

    if (!current.confirmed) {
      current = null; // zapping rápido, no se reporta nada
      return;
    }

    var durationSeconds = Math.round((Date.now() - current.startedAt) / 1000);

    if (!current.startSent) {
      enqueue(current.startAction, REASON.USER_INTERACTION, current.startData);
    }

    var endData = $.extend({}, current.startData, opts.extraEndData || {});
    endData.duration = durationSeconds;

    enqueue(opts.endAction, opts.endReason, endData);

    current = null;
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  Telemetry.init = function () {
    if (initialized) return;
    initialized = true;

    pending = loadPendingFromStorage();

    setTimeout(flush, FIRST_FLUSH_DELAY);
    periodicTimer = setInterval(flush, PERIODIC_FLUSH_INTERVAL);
  };

  /**
   * Cierra lo que sea que esté sonando/reproduciéndose ahora mismo, ANTES
   * de arrancar otra cosa o de resetear el player. Debe llamarse siempre
   * antes de begin*() para el próximo contenido, y también cuando el
   * usuario para la reproducción sin elegir nada nuevo (STOP/back).
   * @param {Object} [opts] { finished: Boolean, timeIndex: Number }
   */
  Telemetry.stopCurrent = function (opts) {
    opts = opts || {};
    if (!current) return;

    if (current.kind === "service") {
      endCurrent({ endAction: ACTION.SWITCHED_AWAY_FROM_STREAM, endReason: REASON.USER_INTERACTION });
    } else if (current.kind === "vod") {
      endCurrent({
        endAction: opts.finished ? ACTION.VOD_FINISHED : ACTION.VOD_STOPPED_PREMATURELY,
        // reasonId: siempre USER_INTERACTION_REASON, igual que el Android real.
        // REASON.VOD_ENDED existe como constante (igual que VOD_ENDED_REASON en
        // TelemetryRecords.java) pero Android nunca la usa en ninguna llamada
        // observada -- storeVodFinishedAction() manda USER_INTERACTION_REASON
        // también. Se corrige acá para no reportar un reasonId que el backend
        // jamás recibe del lado Android.
        endReason: REASON.USER_INTERACTION,
        extraEndData: { timeIndex: opts.timeIndex || 0 }
      });
    } else if (current.kind === "catchup") {
      endCurrent({
        endAction: opts.finished ? ACTION.CATCHUP_FINISHED : ACTION.CATCHUP_STOPPED_PREMATURELY,
        // idem VOD: REASON.CATCHUP_ENDED queda sin usar, ver comentario arriba.
        endReason: REASON.USER_INTERACTION,
        extraEndData: { timeIndex: opts.timeIndex || 0 }
      });
    }
  };

  Telemetry.recordSwitchedToService = function (service) {
    if (!initialized || !service) return;
    Telemetry.stopCurrent(); // cierra lo anterior (prematuro, por definición: se está cambiando de canal)
    // streamId/streamName (no serviceId/serviceName): ver nota "FIX
    // (2026-09-03)" en la cabecera -- el nombre público del método queda
    // igual (recordSwitchedToService, ya usado desde home.js) aunque
    // internamente reporte como STREAM.
    beginCurrent("service", ACTION.SWITCHED_TO_STREAM, {
      streamId: service.id,
      streamName: service.name
    });
  };

  Telemetry.recordSwitchedToVod = function (vod, timeIndex) {
    if (!initialized || !vod) return;
    Telemetry.stopCurrent();
    beginCurrent("vod", ACTION.VOD_STARTED, {
      vodId: vod.id,
      vodName: vod.name,
      timeIndex: timeIndex || 0
    });
  };

  Telemetry.recordSwitchedToCatchup = function (catchupItem, timeIndex) {
    if (!initialized || !catchupItem) return;
    Telemetry.stopCurrent();
    beginCurrent("catchup", ACTION.CATCHUP_STARTED, {
      catchupGroupId: catchupItem.catchupGroupId,
      catchupId: catchupItem.id,
      catchupName: catchupItem.name,
      timeIndex: timeIndex || 0
    });
  };

  /**
   * SOLO PARA PRUEBAS MANUALES DESDE LA CONSOLA. Muestra de un vistazo por
   * qué no se está viendo nada en el log de envío:
   *   Telemetry.debugStatus()
   * - initialized=false        -> Telemetry.init() nunca corrió (revisar que
   *                               home.js la llame al arrancar la escena)
   * - enabled=false            -> el backend ya respondió function_not_available
   *                               esta sesión; dejó de reintentar a propósito
   * - pendingCount=0           -> todavía no hay nada CONFIRMADO para mandar.
   *                               Si estás probando cambios de canal rápidos,
   *                               es esperable: hace falta que un canal quede
   *                               puesto >=5min (o un VOD/catchup >=1min) antes
   *                               de que se encole algo -- es a propósito,
   *                               mismo criterio que usa Android para no
   *                               ensuciar el reporte con zapping.
   * - current                  -> la acción en curso ahora mismo (o null), y
   *                               si ya está "confirmed" (pasó el tiempo mínimo)
   * - hasSession=false         -> no hay sesión todavía (User.getSessionId()),
   *                               flush() se pospone solo
   */
  Telemetry.debugStatus = function () {
    var status = {
      initialized: initialized,
      enabled: enabled,
      sending: sending,
      pendingCount: pending.length,
      hasSession: typeof User !== "undefined" && !!User.getSessionId(),
      current: current ? {
        kind: current.kind,
        confirmed: current.confirmed,
        startSent: current.startSent,
        secondsElapsed: Math.round((Date.now() - current.startedAt) / 1000)
      } : null
    };
    console.log("[Telemetry] debugStatus", status);
    return status;
  };

  /**
   * SOLO PARA PRUEBAS MANUALES DESDE LA CONSOLA. Vacía la cola de pendientes
   * en memoria Y en localStorage -- borrar solo localStorage no alcanza,
   * porque la variable "pending" en memoria ya quedó cargada desde el
   * arranque de la app y no se vuelve a leer del storage hasta el próximo
   * reinicio/reload.
   */
  Telemetry.debugClearQueue = function () {
    pending = [];
    try {
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
    } catch (e) {}
    console.log("[Telemetry] Cola de pendientes vaciada (memoria + localStorage)");
  };

  /**
   * SOLO PARA PRUEBAS MANUALES DESDE LA CONSOLA. Manda records directo a
   * cv.pushTelemetryRecords, sin pasar por la cola/queue -- útil para
   * bisectar qué parte del payload hace que el backend devuelva
   * fatal_error/unknown_error_serverside, probando variantes a mano:
   *
   *   Telemetry.debugPush([])                        // array vacío
   *   Telemetry.debugPush([{ actionId: 7, reasonId: 1 }])  // registro mínimo
   *   Telemetry.debugPush(Telemetry.debugSampleRecord()) // registro "normal" completo
   *
   * cv.js ya loguea el payload exacto (REQUEST pushTelemetryRecords...)
   * antes de mandarlo, así que cada intento queda visible en consola.
   */
  Telemetry.debugPush = function (records, smartcardId) {
    if (typeof cv === "undefined") {
      console.log("[Telemetry] debugPush: cv no está definido todavía");
      return;
    }
    cv.pushTelemetryRecords(records, smartcardId || null, function (result) {
      console.log("[Telemetry] debugPush SUCCESS", result);
    }, function (result) {
      console.log("[Telemetry] debugPush ERROR", result);
    });
  };

  // Registro "normal" de ejemplo (mismo shape que arma buildRecord), para no
  // tener que escribirlo a mano en la consola cada vez.
  Telemetry.debugSampleRecord = function () {
    return [buildRecord(ACTION.SWITCHED_TO_STREAM, REASON.USER_INTERACTION, { test: true })];
  };

  return Telemetry;
})();
