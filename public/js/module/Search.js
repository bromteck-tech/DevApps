/**
 * Search - Módulo del buscador (panel overlay sobre Home)
 *
 * Antes esta lógica (estado, render, navegación con el mando, teclado
 * virtual) vivía mezclada dentro de Scene_Home (home.js). Se extrajo acá,
 * siguiendo el mismo patrón que ya usan EPGCards.js/EPGDetails.js/VOD.js
 * (módulo con una referencia a "homeObject" para pedirle cosas que sólo la
 * escena sabe hacer: reproducir contenido, etc.), en vez de seguir
 * agregando métodos sueltos a home.js.
 *
 * Compatible con TVs Samsung/LG 2019 (ES5).
 */
var Search = (function (Events) {
  var Search = {};

  $.extend(true, Search, Events, {

    // ============================================
    // ESTADO
    // ============================================
    homeObject: null,
    activeTab: "all", // all | service | vod | catchup
    lastQuery: "",
    lastResults: [],

    // Resultados ya agrupados por tipo de la última búsqueda ejecutada
    // (sin recortar), y cuántos de cada tipo están actualmente renderizados
    // en el DOM. Antes había un tope fijo de 60 por sección sin forma de
    // ver más -- el contador mostraba el total real pero esos resultados
    // eran inalcanzables con el control remoto. Ahora, al llegar al final
    // de lo ya renderizado, se agrega el siguiente lote (RENDER_BATCH) en
    // vez de quedar topeado para siempre.
    fullGrouped: { service: [], vod: [], catchup: [], epg: [] },
    renderedLimits: { service: 60, vod: 60, catchup: 60, epg: 60 },
    RENDER_BATCH: 60,

    $lastFocused: null,

    // DOM cacheado
    $container: null,
    $input: null,
    $closeButton: null,
    $tabsContainer: null,
    $resultsContainer: null,
    $count: null,
    $recentRow: null,

    initialized: false,

    // ============================================
    // INIT
    // ============================================
    init: function (homeObject) {
      var self = this;
      this.homeObject = homeObject;

      this.$container = $("#searchContainer");
      this.$input = $("#searchInput");
      this.$closeButton = $("#closeSearchButton");
      this.$tabsContainer = $("#searchTabs");
      this.$resultsContainer = $("#searchResults");
      this.$count = $("#searchResultsCount");
      this.$recentRow = $("#searchRecent");

      SearchManager.init({
        onError: function (error) {
          console.error("Error en SearchManager:", error);
        }
      });

      if (this.$input.length === 0 || this.$closeButton.length === 0) {
        console.warn("Elementos del buscador no encontrados");
        return;
      }

      var placeholderText = __("CustomSearch") || "Buscar...";
      this.$input.attr("placeholder", placeholderText);

      // Input nativo (teclado físico/USB) -- camino secundario, el
      // principal es el teclado propio (ver openKeyboard()).
      this.$input.off("input.search").on("input.search", function () {
        self.performSearch(self.$input.val() || "");
      });

      this.$input.off("keydown.search").on("keydown.search", function (e) {
        var key = e.key || e.keyCode;
        if (key === "Escape" || key === 27) {
          self.hide();
          e.preventDefault();
        }
      });

      // Enter sobre un tab (teclado físico)
      $(document).off("keydown.searchTabEnter").on("keydown.searchTabEnter", function (e) {
        if (self.$container.hasClass("hidden")) return;
        if (e.key !== "Enter" && e.keyCode !== 13) return;
        var $focused = Focus.focused;
        if ($focused && $focused.length && $focused.hasClass("search-tab")) {
          self.setTab($focused.data("tab"));
          e.preventDefault();
        }
      });

      $(document).off("click.searchClose").on("click.searchClose", "#closeSearchButton", function () {
        self.hide();
      });

      $(document).off("click.searchTabs").on("click.searchTabs", ".search-tab", function () {
        self.setTab($(this).data("tab"));
        Focus.to($(this));
      });

      $(document).off("click.searchResult").on("click.searchResult", ".result-item", function () {
        var $el = $(this);
        self.selectContent($el.data("id"), $el.data("type"));
        self.hide();
      });

      $(document).off("click.searchRecent").on("click.searchRecent", ".search-recent-chip", function () {
        var q = $(this).data("query");
        self.$input.val(q);
        self.performSearch(q);
      });

      $(document).off("click.searchRecentClear").on("click.searchRecentClear", ".search-recent-clear", function () {
        SearchManager.clearRecentSearches();
        self.renderResults([], "");
      });

      this.initialized = true;
    },

    /**
     * Refresca textos i18n (placeholder + labels de tabs). Llamado desde
     * Scene_Home.render() en cada render (puede depender de cambio de idioma).
     */
    updateLabels: function () {
      this.$input.attr("placeholder", __("CustomSearch"));
      var labels = {
        all: __("All") || "Todos",
        service: __("Services") || "Servicios",
        vod: "VOD",
        catchup: "Catchup"
      };
      this.$tabsContainer.find(".search-tab").each(function () {
        var $t = $(this);
        var id = $t.data("tab");
        if (labels[id]) $t.text(labels[id]);
      });
    },

    isOpen: function () {
      return this.$container && this.$container.length > 0 && !this.$container.hasClass("hidden");
    },

    // ============================================
    // ABRIR / CERRAR
    // ============================================
    show: function () {
      this.$lastFocused = Focus.focused;
      this.$container.removeClass("hidden");
      this.buildTabs();
      this.setTab("all");
      this.renderResults([], "");

      if (this.$input.length > 0) {
        this.$input.val("");
        Focus.to(this.$input);
        this.openKeyboard();
      }
    },

    hide: function () {
      SearchManager.clearDebounce();

      this.$container.addClass("hidden");
      this.$input.val("");
      this.$resultsContainer.empty();
      this.$count.text("");
      $("#viewport").removeClass("no-scroll");

      if (this.$lastFocused && this.$lastFocused.length > 0) {
        Focus.to(this.$lastFocused);
      } else {
        Focus.to($(".other-option[data-other-id='5']"));
      }
      this.$lastFocused = false;
    },

    /**
     * Abre el teclado propio (Keyboard) sobre el input de búsqueda
     * (readonly), en vez del teclado nativo del TV (OSK) -origen del
     * lag/congelamiento y compactado de pantalla reportado antes-.
     */
    openKeyboard: function () {
      var self = this;
      var $input = this.$input;
      if (!$input.length) return;

      var adapter = new InputAdapter($input);

      function onExit() {
        Keyboard.off("exit", onExit, self);
      }
      Keyboard.on("exit", onExit, self);

      adapter.on("inserted", function () { self.performSearch($input.val() || ""); });
      adapter.on("backspace", function () { self.performSearch($input.val() || ""); });
      adapter.on("clear-all-text", function () { self.performSearch(""); });

      Keyboard.show(adapter);
    },

    // ============================================
    // TABS
    // ============================================
    getAvailableTabs: function () {
      var tabs = [{ id: "all", label: __("All") || "Todos" }];

      var hasServices = Array.isArray(AppData.services) && AppData.services.length > 0;
      var hasVods = Array.isArray(AppData.allVods) && AppData.allVods.length > 0;

      var hasCatchup = false;
      if (Array.isArray(AppData.catchupGroups) && AppData.catchupGroups.length > 0) {
        for (var i = 0; i < AppData.catchupGroups.length; i++) {
          var g = AppData.catchupGroups[i];
          if (g && Array.isArray(g.events) && g.events.length > 0) {
            hasCatchup = true;
            break;
          }
        }
      }

      if (hasServices) tabs.push({ id: "service", label: __("Services") || "Servicios" });
      if (hasVods) tabs.push({ id: "vod", label: "VOD" });
      if (hasCatchup) tabs.push({ id: "catchup", label: "Catchup" });

      return tabs;
    },

    buildTabs: function () {
      if (this.$tabsContainer.length === 0) return;

      var tabs = this.getAvailableTabs();
      var html = "";
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var isActive = (t.id === (this.activeTab || "all"));
        html += '<div class="search-tab focusable' + (isActive ? " active" : "") + '" data-tab="' + t.id + '">' + t.label + "</div>";
      }
      this.$tabsContainer.html(html);

      if (this.$tabsContainer.find(".search-tab[data-tab='" + (this.activeTab || "all") + "']").length === 0) {
        this.activeTab = "all";
        this.$tabsContainer.find(".search-tab").removeClass("active");
        this.$tabsContainer.find(".search-tab[data-tab='all']").addClass("active");
      }
    },

    setTab: function (tab) {
      if (!tab) tab = "all";
      this.activeTab = tab;
      this.$tabsContainer.find(".search-tab").removeClass("active");
      this.$tabsContainer.find(".search-tab[data-tab='" + tab + "']").addClass("active");
      // Re-render con el último estado de búsqueda (no dispara una búsqueda nueva)
      this._renderFromState();
    },

    updateTabsVisibility: function (vodsCount, catchupsCount, isEmptyQuery) {
      var hideVods = !isEmptyQuery && (!vodsCount || vodsCount <= 0);
      var hideCatchup = !isEmptyQuery && (!catchupsCount || catchupsCount <= 0);

      var $vodTab = this.$tabsContainer.find(".search-tab[data-tab='vod']");
      var $catchupTab = this.$tabsContainer.find(".search-tab[data-tab='catchup']");

      $vodTab.toggleClass("hidden", hideVods);
      $catchupTab.toggleClass("hidden", hideCatchup);

      if ((hideVods && this.activeTab === "vod") || (hideCatchup && this.activeTab === "catchup")) {
        this.activeTab = "all";
        this.$tabsContainer.find(".search-tab").removeClass("active");
        this.$tabsContainer.find(".search-tab[data-tab='all']").addClass("active");
      }
    },

    // ============================================
    // BÚSQUEDA
    // ============================================
    performSearch: function (query) {
      var self = this;
      SearchManager.search(query).then(function (results) {
        self.lastQuery = query || "";
        self.lastResults = results || [];
        if (self.lastQuery.trim().length > 0) {
          SearchManager.addRecentSearch(self.lastQuery);
        }
        self.renderResults(results, query);
        self._updateKeyboardSuggestions(results, query);
      }).catch(function (error) {
        console.error("Error en búsqueda:", error);
        self.lastQuery = query || "";
        self.lastResults = [];
        self.renderResults([], query);
        self._updateKeyboardSuggestions([], query);
      });
    },

    /**
     * Muestra hasta 3 títulos de resultados como chips de sugerencia sobre
     * el teclado (modo "manual" de Keyboard: acá ya tenemos resultados
     * ordenados por relevancia de SearchManager, así que se le pasan
     * directo en vez de que Keyboard vuelva a filtrar por su cuenta).
     * Sólo toca el teclado si es efectivamente el que está abierto ahora
     * mismo (Keyboard es una instancia única compartida con login, etc.).
     */
    _updateKeyboardSuggestions: function (results, query) {
      if (!Keyboard.$el || !Keyboard.$el.is(":visible")) return;
      Keyboard.setSuggestions(this._buildSuggestionNames(results, query));
    },

    /**
     * Arma la lista de nombres para los chips: hasta 3, sin duplicados y
     * sin repetir el texto que el usuario ya escribió tal cual.
     * @returns {Array<String>}
     */
    _buildSuggestionNames: function (results, query) {
      var trimmed = (query || "").trim().toLowerCase();
      if (!results || !results.length || trimmed.length < 2) return [];

      var seen = {}, names = [];
      for (var i = 0; i < results.length && names.length < 3; i++) {
        var name = results[i] && results[i].name;
        if (!name) continue;
        var key = name.toLowerCase();
        if (key === trimmed || seen[key]) continue;
        seen[key] = true;
        names.push(name);
      }
      return names;
    },

    // ============================================
    // RENDER
    // ============================================
    _escapeHtml: function (text) {
      if (text == null) return "";
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    /**
     * Devuelve el título con el fragmento que matchea la query envuelto en
     * <span class="search-match"> (case-insensitive, primera ocurrencia).
     */
    _highlight: function (text, query) {
      var safeText = this._escapeHtml(text);
      if (!query) return safeText;
      var idx = String(text).toLowerCase().indexOf(String(query).toLowerCase().trim());
      if (idx === -1) return safeText;

      var before = this._escapeHtml(text.substring(0, idx));
      var match = this._escapeHtml(text.substring(idx, idx + query.trim().length));
      var after = this._escapeHtml(text.substring(idx + query.trim().length));
      return before + '<span class="search-match">' + match + "</span>" + after;
    },

    renderResults: function (results, query) {
      var isEmptyQuery = !query || (typeof query === "string" && query.trim().length === 0);

      // Agrupar por tipo (service / vod / catchup / epg) y reiniciar los
      // límites de renderizado incremental de esta nueva búsqueda.
      var grouped = { service: [], vod: [], catchup: [], epg: [] };
      for (var i = 0; i < (results || []).length; i++) {
        var r = results[i];
        if (!r || !grouped[r.type]) continue;
        grouped[r.type].push(r);
      }

      this.fullGrouped = grouped;
      this.renderedLimits = { service: this.RENDER_BATCH, vod: this.RENDER_BATCH, catchup: this.RENDER_BATCH, epg: this.RENDER_BATCH };
      this.lastQuery = query || "";
      this.lastIsEmptyQuery = isEmptyQuery;

      this._renderFromState();
    },

    /**
     * Reconstruye el DOM de resultados a partir de fullGrouped/renderedLimits
     * y del tab activo, sin volver a ejecutar la búsqueda. Se separó de
     * renderResults() para poder llamarse tanto al cambiar de tab como al
     * "cargar más" (scroll infinito) sin duplicar la lógica de agrupado.
     */
    _renderFromState: function () {
      var self = this;
      var grouped = this.fullGrouped;
      var query = this.lastQuery;
      var isEmptyQuery = this.lastIsEmptyQuery;

      this._renderRecentRow(isEmptyQuery);

      this.$count.text("");
      this.$resultsContainer.empty();

      var totalReal = grouped.service.length + grouped.vod.length + grouped.catchup.length + grouped.epg.length;

      if (totalReal === 0) {
        this.updateTabsVisibility(0, 0, isEmptyQuery);
        this._renderEmptyState(isEmptyQuery);
        return;
      }

      this.updateTabsVisibility(grouped.vod.length, grouped.catchup.length, isEmptyQuery);

      var fragment = document.createDocumentFragment();

      var addItems = function (items, limit) {
        if (!items || items.length === 0) return;
        var slice = items.slice(0, limit);
        for (var j = 0; j < slice.length; j++) {
          fragment.appendChild(self._buildResultCard(slice[j], query));
        }
      };

      var addSection = function (title, items, limit) {
        if (!items || items.length === 0) return;
        var header = document.createElement("div");
        header.className = "search-section-title";
        header.innerText = title;
        fragment.appendChild(header);
        addItems(items, limit);
      };

      var tab = this.activeTab || "all";
      var renderedTotal = 0;

      if (tab === "all") {
        addSection(__("Services") || "Servicios", grouped.service, this.renderedLimits.service);
        addSection(__("EPGSlotNow") || "En pantalla", grouped.epg, this.renderedLimits.epg);
        addSection("VOD", grouped.vod, this.renderedLimits.vod);
        addSection("Catchup", grouped.catchup, this.renderedLimits.catchup);
        renderedTotal = Math.min(grouped.service.length, this.renderedLimits.service)
          + Math.min(grouped.epg.length, this.renderedLimits.epg)
          + Math.min(grouped.vod.length, this.renderedLimits.vod)
          + Math.min(grouped.catchup.length, this.renderedLimits.catchup);
      } else if (grouped[tab]) {
        addItems(grouped[tab], this.renderedLimits[tab]);
        renderedTotal = Math.min(grouped[tab].length, this.renderedLimits[tab]);
      }

      this.$resultsContainer[0].appendChild(fragment);

      var total = 0;
      if (tab === "all") total = grouped.service.length + grouped.vod.length + grouped.catchup.length + grouped.epg.length;
      else if (grouped[tab]) total = grouped[tab].length;
      this.$count.text(total + " " + (total === 1 ? "resultado" : "resultados"));
    },

    _renderEmptyState: function (isEmptyQuery) {
      var fragment = document.createDocumentFragment();

      var message = isEmptyQuery
        ? (__("CustomSearch") || "Escribe para buscar")
        : (__("ErrorFind") || "No se encontraron resultados.");

      var p = document.createElement("p");
      p.className = "search-results-empty";
      p.innerText = message;
      fragment.appendChild(p);

      this.$resultsContainer[0].appendChild(fragment);
    },

    /**
     * Fila compacta de "búsquedas recientes", pegada al buscador (arriba de
     * los tabs), no dentro del panel de resultados. Antes vivía como un
     * bloque grande y centrado ahí adentro, con un botón rojo "Borrar
     * historial" -- se sentía invasivo para algo tan secundario. Ahora es
     * una sola línea con chips discretos y "Borrar" como texto, visible
     * sólo cuando no hay query en curso y hay algo en el historial.
     */
    _renderRecentRow: function (isEmptyQuery) {
      if (!this.$recentRow || this.$recentRow.length === 0) return;

      var recent = isEmptyQuery ? SearchManager.getRecentSearches() : [];
      if (!recent || recent.length === 0) {
        this.$recentRow.addClass("hidden").empty();
        return;
      }

      var fragment = document.createDocumentFragment();

      var label = document.createElement("span");
      label.className = "search-recent-label";
      label.innerText = __("SearchRecent") || "Recientes";
      fragment.appendChild(label);

      recent.forEach(function (q) {
        var chip = document.createElement("span");
        chip.className = "search-recent-chip focusable";
        chip.setAttribute("data-query", q);
        chip.innerText = q;
        fragment.appendChild(chip);
      });

      // Spacer en vez de "margin-left: auto" en el link "Borrar": la clase
      // .focus global (ver style.css) fuerza "margin: 2px" sobre CUALQUIER
      // elemento enfocado, lo que pisaba el margin-left:auto y hacía que
      // "Borrar" saltara de posición justo al enfocarlo.
      var spacer = document.createElement("span");
      spacer.className = "search-recent-spacer";
      fragment.appendChild(spacer);

      var clear = document.createElement("span");
      clear.className = "search-recent-clear focusable";
      clear.innerText = __("SearchClearHistory") || "Borrar";
      fragment.appendChild(clear);

      this.$recentRow.empty()[0].appendChild(fragment);
      this.$recentRow.removeClass("hidden");
    },

    /**
     * Construye la card de un resultado. A diferencia de la versión
     * anterior (misma card genérica para los 3 tipos), acá cada tipo tiene
     * su propio badge/subtítulo para poder distinguirlos de un vistazo.
     */
    _buildResultCard: function (result, query) {
      var logo = result.logo || "";
      var name = result.name || "";
      var type = result.type;

      var div = document.createElement("div");
      div.className = "result-item focusable";
      div.setAttribute("data-id", result.id);
      div.setAttribute("data-type", type);

      var badge = null;
      if (type === "service" || (type === "epg" && result.isLive)) {
        badge = document.createElement("div");
        badge.className = "result-badge result-badge-live";
        badge.innerText = __("SearchLive") || "En vivo";
      } else if (type === "vod") {
        badge = document.createElement("div");
        badge.className = "result-badge " + (result.isSeries ? "result-badge-series" : "result-badge-movie");
        badge.innerText = result.isSeries ? (__("SearchSeries") || "Serie") : (__("MenuMovies") || "Película");
      } else if (type === "catchup") {
        badge = document.createElement("div");
        badge.className = "result-badge result-badge-catchup";
        badge.innerText = "Catchup";
      }
      if (badge) div.appendChild(badge);

      var img = document.createElement("img");
      img.src = logo;
      img.alt = name + " Logo";
      img.className = "channel-logo";
      img.setAttribute("onerror", "imgOnError(this)");
      div.appendChild(img);

      var textDiv = document.createElement("div");
      textDiv.className = "channel";
      textDiv.innerHTML = this._highlight(name, query);
      div.appendChild(textDiv);

      // Sub-línea con el nombre del canal, sólo para resultados de EPG
      // (en vivo/próximo) -- ahí "name" es el título del programa, no el
      // canal, así que hace falta aclarar en qué canal está.
      if (type === "epg" && result.channelName) {
        var subtitle = document.createElement("div");
        subtitle.className = "result-item-subtitle";
        subtitle.innerText = result.channelName;
        div.appendChild(subtitle);
      }

      return div;
    },

    /**
     * Si hay más resultados de los que ya están renderizados para el tab
     * activo, agranda el/los límites correspondientes y vuelve a construir
     * el DOM (conservando el scroll, mismo criterio que EPGCards._renderCards).
     * @returns {Boolean} true si efectivamente había más para cargar
     */
    _growIfNeeded: function () {
      var grouped = this.fullGrouped;
      var tab = this.activeTab || "all";
      var types = (tab === "all") ? ["service", "epg", "vod", "catchup"] : [tab];
      var grew = false;

      for (var i = 0; i < types.length; i++) {
        var t = types[i];
        if (grouped[t] && grouped[t].length > this.renderedLimits[t]) {
          this.renderedLimits[t] += this.RENDER_BATCH;
          grew = true;
        }
      }

      if (grew) {
        var savedScrollTop = this.$resultsContainer.scrollTop();
        this._renderFromState();
        this.$resultsContainer.scrollTop(savedScrollTop);
      }
      return grew;
    },

    // ============================================
    // SELECCIÓN DE CONTENIDO
    // ============================================
    selectContent: function (id, type) {
      var self = this;
      var home = this.homeObject;

      if (type === "service" || type === "epg") {
        // Un resultado de programación EPG (en vivo/próximo) se resuelve
        // igual que un canal: "id" es el id del servicio/canal.
        var service = AppData.getServiceTV(id);
        if (service && service.url) {
          home.playContentWithAccess("service", service.id, service.url, service, true, false);
        }
      } else if (type === "vod") {
        VODDetail.show(id, null, home);
      } else if (type === "catchup") {
        var catchup = AppData.getCatchupByEventId(id);
        if (catchup && catchup !== false) {
          AppData.getTopLevelCatchupM3u8Url(catchup.id, function (url) {
            if (url && url.length > 0) {
              home.playContentWithAccess("catchup-event", catchup.id, url, catchup, true, false);
            } else {
              console.error("No se pudo obtener la URL del catchup para el ID:", id);
            }
          });
        } else {
          console.error("No se encontró el catchup con ID:", id);
        }
      }
    },

    // ============================================
    // ENTER (OK del control remoto / click)
    // Devuelve true si el evento fue manejado acá (Scene_Home.onEnter debe
    // retornar de inmediato), false si debe seguir evaluando el resto.
    // ============================================
    onEnter: function ($el) {
      if ($el.is(this.$closeButton)) {
        this.hide();
        return true;
      }

      if (this.isOpen() && $el.is(this.$input)) {
        this.openKeyboard();
        return true;
      }

      if (this.isOpen() && $el.hasClass("result-item")) {
        this.selectContent($el.data("id"), $el.data("type"));
        this.hide();
        return true;
      }

      if (this.isOpen() && $el.hasClass("search-recent-chip")) {
        var q = $el.data("query");
        this.$input.val(q);
        this.performSearch(q);
        return true;
      }

      if (this.isOpen() && $el.hasClass("search-recent-clear")) {
        SearchManager.clearRecentSearches();
        this.renderResults([], "");
        return true;
      }

      return false;
    },

    onReturn: function () {
      if (this.isOpen()) {
        this.hide();
        return true;
      }
      return false;
    },

    // ============================================
    // NAVEGACIÓN CON EL CONTROL REMOTO
    // ============================================

    navigate: function (direction, $el) {
      var $closeButton = this.$closeButton;
      var $input = this.$input;
      var $tabs = this.$tabsContainer.find(".search-tab.focusable:not(.hidden)");
      var $results = this.$resultsContainer.find(".result-item.focusable");
      var $recentItems = this.$recentRow.find(".focusable");

      var $resultsContainer = this.$resultsContainer;
      var containerHeight = $resultsContainer.height();

      if ($el.is($closeButton)) {
        if (direction === "down" && $input.length) {
          Focus.to($input);
        } else if (direction === "left" && $input.length) {
          Focus.to($input);
        }
        return true;
      }

      if ($el.is($input)) {
        if (direction === "down") {
          if ($recentItems.length) {
            Focus.to($recentItems.first());
          } else if ($tabs.length) {
            Focus.to($tabs.first());
          } else if ($results.length > 0) {
            Focus.to($results.first());
          }
        } else if (direction === "right") {
          // El botón "×" está a la derecha del input en la barra superior
          // (ver .search-input-container en index.html) -- moverse a la
          // derecha debe ir ahí, no saltar directo a los resultados (eso
          // ya lo cubre "abajo").
          if ($closeButton.length) Focus.to($closeButton);
        } else if (direction === "up" || direction === "left") {
          // Nada a la izquierda del input (el ícono de lupa no es focusable).
          return true;
        }
        return true;
      }

      // Fila compacta de "búsquedas recientes" (chips + "Borrar"), pegada
      // al buscador entre el input y los tabs -- ver _renderRecentRow().
      // Es siempre una sola fila (no un grid con secciones), así que acá sí
      // alcanza con índice plano, sin el cuidado geométrico que hace falta
      // más abajo para la grilla de resultados.
      if ($el.hasClass("search-recent-chip") || $el.hasClass("search-recent-clear")) {
        var currentRecentIndex = $recentItems.index($el);
        if (direction === "up") {
          if ($input.length) Focus.to($input);
          return true;
        }
        if (direction === "down") {
          if ($tabs.length) {
            Focus.to($tabs.first());
          } else if ($results.length > 0) {
            Focus.to($results.first());
          }
          return true;
        }
        if (direction === "left") {
          if (currentRecentIndex > 0) Focus.to($recentItems.eq(currentRecentIndex - 1));
          return true;
        }
        if (direction === "right") {
          if (currentRecentIndex >= 0 && currentRecentIndex < $recentItems.length - 1) Focus.to($recentItems.eq(currentRecentIndex + 1));
          return true;
        }
        return true;
      }

      if ($el.hasClass("search-tab")) {
        var currentTabIndex = $tabs.index($el);
        if (direction === "left") {
          if (currentTabIndex > 0) Focus.to($tabs.eq(currentTabIndex - 1));
          return true;
        }
        if (direction === "right") {
          if (currentTabIndex >= 0 && currentTabIndex < $tabs.length - 1) Focus.to($tabs.eq(currentTabIndex + 1));
          return true;
        }
        if (direction === "up") {
          if ($recentItems.length) {
            Focus.to($recentItems.first());
          } else if ($input.length) {
            Focus.to($input);
          }
          return true;
        }
        if (direction === "down") {
          if ($results.length > 0) Focus.to($results.first());
          return true;
        }
        return true;
      }

      // Navegación dentro de RESULTADOS.
      //
      // IMPORTANTE: en el tab "Todos" los resultados están agrupados en
      // secciones (Servicios / En pantalla / VOD / Catchup) separadas por
      // un <div class="search-section-title"> con grid-column:1/-1 (ver
      // search.css), que fuerza un salto de fila en el grid. Por eso no se
      // puede navegar con aritmética de índice fijo -- en cuanto una
      // sección no termina en un múltiplo exacto de columnas, el índice de
      // la sección siguiente queda desalineado de la fila visual real.
      //
      // La navegación agrupa por posición real en el DOM usando
      // offsetTop/offsetLeft nativos (NO jQuery .position()/.offset(), que
      // usan getBoundingClientRect() y por lo tanto sí reflejan `transform:
      // scale(1.05)` de .result-item:focus -- eso hacía que la card
      // enfocada se midiera corrida respecto a sus vecinas sin foco).
      //
      // ROW_TOLERANCE: cards de la MISMA fila de CSS Grid no siempre
      // reportan exactamente el mismo offsetTop -- se vieron diferencias de
      // ~2px entre "compañeros de fila" (subpíxel de layout con alturas en
      // em). Con una tolerancia de 1px, esos compañeros quedaban
      // clasificados como "otra fila", así que ARRIBA/ABAJO en realidad
      // terminaba moviendo el foco DENTRO de la misma fila (de ahí que
      // "arriba" se sintiera como "derecha" y luego oscilara). El salto
      // real entre filas es de cientos de píxeles, así que un margen de
      // 10px es más que suficiente para absorber el jitter sin confundir
      // dos filas reales entre sí.
      if ($el.hasClass("result-item")) {
        var ROW_TOLERANCE = 10;
        var currentTop = $el[0].offsetTop;
        var currentLeft = $el[0].offsetLeft;

        if (direction === "up" || direction === "down") {
          if (direction === "down") {
            var lastTop = $results.length ? $results.last()[0].offsetTop : 0;
            if (Math.abs(currentTop - lastTop) < ROW_TOLERANCE && this._growIfNeeded()) {
              $results = this.$resultsContainer.find(".result-item.focusable");
            }
          }

          // Agrupar los offsetTop candidatos por clusters (en vez de valores
          // exactos) para que el jitter de subpíxel no cree "filas" de más.
          var rowTops = [];
          $results.each(function () {
            var t = this.offsetTop;
            var isTarget = direction === "up" ? (t < currentTop - ROW_TOLERANCE) : (t > currentTop + ROW_TOLERANCE);
            if (!isTarget) return;
            for (var ci = 0; ci < rowTops.length; ci++) {
              if (Math.abs(rowTops[ci] - t) < ROW_TOLERANCE) return;
            }
            rowTops.push(t);
          });

          if (rowTops.length === 0) {
            if (direction === "up") {
              if ($tabs.length) {
                Focus.to($tabs.first());
              } else if ($input.length) {
                Focus.to($input);
              }
            }
            // "down" al final de todo: no hay nada más, no mover foco.
            return true;
          }

          var targetTop = direction === "up" ? Math.max.apply(null, rowTops) : Math.min.apply(null, rowTops);

          var rowItems = [];
          $results.each(function () {
            if (Math.abs(this.offsetTop - targetTop) < ROW_TOLERANCE) {
              rowItems.push({ el: $(this), left: this.offsetLeft });
            }
          });
          rowItems.sort(function (a, b) {
            return Math.abs(a.left - currentLeft) - Math.abs(b.left - currentLeft);
          });

          var $target = rowItems[0].el;
          Focus.to($target);

          var targetTopPos = $target[0].offsetTop;
          var targetHeight = $target[0].offsetHeight || 0;
          if (direction === "up") {
            // Si la fila destino es la primera del todo (no hay ninguna
            // fila más arriba de ella), llevar el scroll al tope exacto en
            // vez de solo compensar lo que sobresale.
            var isFirstRow = true;
            $results.each(function () {
              if (this.offsetTop < targetTopPos - ROW_TOLERANCE) isFirstRow = false;
            });
            if (isFirstRow) {
              $resultsContainer.scrollTop(0);
            } else if (targetTopPos < $resultsContainer.scrollTop()) {
              $resultsContainer.scrollTop(targetTopPos);
            }
          } else if (targetHeight > 0 && (targetTopPos + targetHeight - $resultsContainer.scrollTop()) > containerHeight) {
            $resultsContainer.scrollTop(targetTopPos + targetHeight - containerHeight);
          }
          return true;
        }

        if (direction === "left" || direction === "right") {
          var sameRow = [];
          $results.each(function () {
            if (Math.abs(this.offsetTop - currentTop) < ROW_TOLERANCE) {
              sameRow.push({ el: $(this), left: this.offsetLeft });
            }
          });
          sameRow.sort(function (a, b) { return a.left - b.left; });

          var idxInRow = -1;
          for (var k = 0; k < sameRow.length; k++) {
            if (sameRow[k].el.is($el)) { idxInRow = k; break; }
          }

          if (direction === "left") {
            if (idxInRow <= 0) {
              if ($tabs.length) {
                Focus.to($tabs.first());
              } else if ($input.length) {
                Focus.to($input);
              }
              return true;
            }
            Focus.to(sameRow[idxInRow - 1].el);
            return true;
          }

          // right: sin wrap a la siguiente fila (mismo comportamiento que antes)
          if (idxInRow === -1 || idxInRow >= sameRow.length - 1) {
            return true;
          }
          Focus.to(sameRow[idxInRow + 1].el);
          return true;
        }
        return true;
      }

      return false;
    }
  });

  return Search;
})(Events);
