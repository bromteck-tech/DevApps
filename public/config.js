ENV = 'PRODUCTION';

var parseQueryString = function () {

  var str = window.location.search;
  var objURL = {};

  str.replace(
    new RegExp("([^?=&]+)(=([^&]*))?", "g"),
    function ($0, $1, $2, $3) {
      objURL[$1] = $3;
    }
  );
  return objURL;
};

CONFIG_CURRENT_BRAND = [];
var _getBrand = parseQueryString().brand;
var _filtered = CONFIG_BRANDS.filter(function (item) {
  return item.brand == _getBrand;
});

if (_filtered != null && _filtered.length == 1) {
  CONFIG_CURRENT_BRAND = _filtered[0];
}

// A partir de ahora las marcas usan estructura por Flags:
// LoginFlags / PlayerFlags / HomeFlags / EpgFlags
var BRAND = CONFIG_CURRENT_BRAND || {};
var LoginFlags = BRAND.LoginFlags || {};
var PlayerFlags = BRAND.PlayerFlags || {};
var HomeFlags = BRAND.HomeFlags || {};
var EpgFlags = BRAND.EpgFlags || {};

var pick = function (value, fallback) {
  return (typeof value !== "undefined" && value !== null) ? value : fallback;
};

CONFIG = {
  locale: Device.getValidLanguage(),
  versionSDK: '2.1.292 [17.02.2017]',  // SDK version  (format: X.Y.SDK_SVN_Revision_number)
  //version: '2.0.1', // application version
  automaticActivation: true,
  developer: {
    debug: false,
    active: true,
    console: null,
    pin: '99999' // show short info about application
  },
  player: {
    muted: false
  },
  ajax: {
    timeout: 60000
  },
  keyboard: {
    oneLayout: false
  },
  GA: {
    account: '', // account number for Google Analytics
    ssl: true
  },
  mouse: {
    modeArrows: 'auto', // mode of showing arrows: on/off/auto   // auto -> arrows will be showed automatically (after Mouse moving is detected)
    hideArrows: 15000, // how long can be arrows visible, used only for mode='auto' [ms]
    rightIsReturn: false // set mouse right click to press Return/Back key on RC
  },
  app: {
    production: false,
    brand: BRAND.brand,
    appName: BRAND.appName,
    drmURL: BRAND.drm,
    drmToken: BRAND.token,
    version: BRAND.version, // application version
    developedBy: BRAND.developedBy,
    epgApiKey: "724aa4b262071d28844ac2fa85fe7eb198d9cb819c8913f6769b2b48a56a1f61",
    epgApiToken: "OMGRUhcoXKFqnpzZEfrF",
    imageUrlVodPosterList: "%base_url%/cv_data_pub/images/%image_id%/v/vod_poster_list.jpg",
    imageUrlVodPosterInfo: "%base_url%/cv_data_pub/images/%image_id%/v/vod_poster_info.jpg",
    imageUrlVodOriginalImage: "%base_url%/cv_data_pub/images/%image_id%/v/original.jpg",
    catchupRecordingHoursLimit: 20,
    newEpgRowsOnInit: 300,
    maxAutoActivateLicense: 10, //times
    defaultInactivityTimeout: 21600, //seconds
    udidEnabled: !!pick(LoginFlags.udidEnabled, false), // si está habilitado, se muestra el campo de UDID en el login
    baseUrl: pick(LoginFlags.baseUrl, ""), // base url
    wsUrl: pick(LoginFlags.wsUrl, ""), // websocket url
    QR: !!pick(LoginFlags.QR, false), // muestra QR en el login
    QRUrl: pick(LoginFlags.QRUrl, ""), // url del QR
    showTime: !!pick(HomeFlags.showTime, false), // muestra la hora en la home
    showRating: !!pick(HomeFlags.showRating, false), // muestra la calificación en la home
    logoPositionHome: pick(HomeFlags.logoPositionHome, "right"), // posición del logo en la home
    imageEventProgramPastEnabled: !!pick(HomeFlags.imageEventProgramPastEnabled, false), // muestra imagen del evento pasado
    seekbarEnabled: !!pick(PlayerFlags.seekbarEnabled, false), // si está habilitado, se muestra la barra de tiempo en el mini player
    miniPlayerEnabled: pick(PlayerFlags.miniPlayerEnabled, null), // si está habilitado, se muestra el mini player en la home
    osmsEnabled: !!pick(HomeFlags.osmsEnabled, false), // muestra el OSMS en la home
    logoutEnabled: !!pick(HomeFlags.logoutEnabled, false), // si está habilitado, se muestra el botón de logout en el menú
    epgHoursLimit: pick(EpgFlags.epgHoursLimit, 12) || 12, // Límite de horas de EPG a cargar por canal
    epgLineColorTime: pick(EpgFlags.epgLineColorTime, "#3333FF"), // color de la línea de tiempo en el epg
    epgCards: !!pick(EpgFlags.epgCards, false), // si está habilitado, se muestra el epg con tarjetas
    epgDaysOffset: pick(EpgFlags.epgDaysOffset, 2), // cantidad de días hacia atrás a pedir al CDN de EPG (pastDays). Antes era hardcodeado: 1 para "rsogo", 2 para el resto -- rsogo ahora fija epgDaysOffset:1 explícito para no cambiar su comportamiento.
    epgPast: !!pick(EpgFlags.epgPast, false), // si está habilitado, muestra la columna "Antes" con eventos pasados
    epgPagesPastEnabled: !!pick(EpgFlags.epgPagesPastEnabled, false), // si está habilitado, permite la paginación en la columna "Antes"
    epgCardsChannelActiveBg: pick(EpgFlags.epgCardsChannelActiveBg, "#3B699D"), // color de fondo de la columna del canal
    epgCardsProgramLiveBg: pick(EpgFlags.epgCardsProgramLiveBg, "#F58225"), // color de fondo de la columna de programa en vivo
    epgCardsLaterGlobal: !!pick(EpgFlags.epgCardsLaterGlobal, false), // si está habilitado, permite la paginación de "Más Tarde" de forma global (todas las filas)
    epgCardsPastGlobal: !!pick(EpgFlags.epgCardsPastGlobal, false), // si está habilitado, permite la paginación de "Antes" de forma global (todas las filas), igual que epgCardsLaterGlobal pero para el pasado
    epgDisableLaterNavigation: !!pick(EpgFlags.epgDisableLaterNavigation, false), // si está habilitado, bloquea navegación a la derecha hacia eventos futuros ("Más Tarde")
    loadingDesign: !!pick(EpgFlags.loadingDesign, false), // si está habilitado, muestra el diseño completo del componente loading
    vodRedesignEnabled: !!pick(PlayerFlags.vodRedesignEnabled, false), // si está habilitado, se muestra el diseño nuevo de los videos en vivo
  }
};
