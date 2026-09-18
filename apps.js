import UserLocation from "./UserLocation.js";
import NetworkService from "./NetworkService.js";
import DataHandler from "./DataHandler.js";

// Module-scoped variables
let mapInstance = null;
let stationMarkers = [];
let userMarker = null;
let currentUserCoords = null;
let appControllerInstance = null;
window.debugAppController = null;

export default class AppController {
  constructor() {
    appControllerInstance = this;
    this.cachedHash = "";
    this.pollingInterval = null;
    this.currentStationsData = [];
    this.currentNetworkId = null;
    this.lastRenderedSortKey = null;
    this.initDOM();
    this.previousMetrics = new Map(); // Tracks previous bike/dock counts for highlighting changes
    window.debugAppController = this;
  }

  initDOM() {
    this.dom = {
      dropdown: document.getElementById("toggle-choice"),
      statusMessage: document.getElementById("status-message"),
      stationList: document.getElementById("station-list"),
      refreshBtn: document.getElementById("refresh-btn"),
      searchRefreshBtn: document.getElementById("searchRefreshBtn"),
      searchSection: document.getElementById("searchSectionContainer"),
      searchInput: document.getElementById("cityInput"),
      searchBtn: document.getElementById("searchBtn"),
      searchStatus: document.getElementById("searchStatusMessage"),
      stationSelect: document.getElementById("stationSelectContainer"),
      stationDropdown: document.getElementById("stationDropdown"),
      stationDetails: document.getElementById("selectedStationDetails"),
      networkTitle: document.getElementById("networkTitleLabel"),
      directions: document.getElementById("directionsContainer"),
    };

    // Inject a dedicated screen reader announcement region
    this.setupScreenReaderAnnouncer();

    this.bindEvents();
    this.startLocationBoot();
  }

  setupScreenReaderAnnouncer() {
    let announcer = document.getElementById("sr-announcer");
    if (!announcer) {
      announcer = document.createElement("div");
      announcer.id = "sr-announcer";
      announcer.setAttribute("aria-live", "polite");
      announcer.setAttribute("aria-atomic", "true");
      announcer.style.position = "absolute";
      announcer.style.width = "1px";
      announcer.style.height = "1px";
      announcer.style.padding = "0";
      announcer.style.margin = "-1px";
      announcer.style.overflow = "hidden";
      announcer.style.clip = "rect(0, 0, 0, 0)";
      announcer.style.whiteSpace = "nowrap";
      announcer.style.border = "0";
      document.body.appendChild(announcer);
    }
    this.dom.srAnnouncer = announcer;
  }

  speak(message) {
    if (!this.dom.srAnnouncer) return;
    this.dom.srAnnouncer.textContent = "";
    setTimeout(() => {
      this.dom.srAnnouncer.textContent = message;
    }, 50);
  }

  updateDOM(state = {}) {
    if (state.status !== undefined && this.dom.statusMessage) {
      this.dom.statusMessage.textContent = state.status.text || "";
      this.dom.statusMessage.style.color = state.status.color || "#000";
      if (state.status.text) {
        this.speak(state.status.text);
      }
    }

    if (state.searchStatus !== undefined && this.dom.searchStatus) {
      this.dom.searchStatus.textContent = state.searchStatus.text || "";
      this.dom.searchStatus.style.color = state.searchStatus.color || "#000";
      if (state.searchStatus.text) {
        this.speak(state.searchStatus.text);
      }
    }

    if (state.stationDetails !== undefined && this.dom.stationDetails) {
      this.dom.stationDetails.innerHTML = state.stationDetails;
    }

    if (state.networkTitle !== undefined && this.dom.networkTitle) {
      this.dom.networkTitle.textContent = state.networkTitle;
    }

    const visibilityMap = {
      searchSection: state.showSearch,
      searchRefreshBtn: state.showSearchRefresh,
      stationSelect: state.showStationSelect,
      directions: state.showDirections,
    };

    for (const [key, show] of Object.entries(visibilityMap)) {
      if (show !== undefined && this.dom[key]) {
        this.dom[key].classList.toggle("hidden", !show);
      }
    }
  }

  bindEvents() {
    const handleUpdate = (e) => {
      this.updateStations(true);
      if (e.target === this.dom.dropdown) {
        this.dom.dropdown.focus();
      }
    };

    this.dom.dropdown?.addEventListener("change", handleUpdate);
    this.dom.refreshBtn?.addEventListener("click", () =>
      this.updateStations(true),
    );
    this.dom.searchRefreshBtn?.addEventListener("click", () =>
      this.handleSearchRefresh(),
    );

    this.dom.searchBtn?.addEventListener("click", () =>
      this.handleCitySearch(this.dom.searchInput.value),
    );

    this.dom.searchInput?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handleCitySearch(this.dom.searchInput.value);
    });

    // ⚡ Clear error banner and search status the moment the user types anything
    this.dom.searchInput?.addEventListener("input", () => {
      if (this.dom.stationList) {
        this.dom.stationList.innerHTML = "";
      }
      this.updateDOM({ searchStatus: { text: "", color: "#666" } });
    });

    this.dom.stationDropdown?.addEventListener("change", (e) => {
      const idx = e.target.value;
      this.selectStationByIndex(idx);
    });

    this.dom.stationList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".gps-dir-btn");
      if (!btn) return;

      const idx = btn.dataset.index;
      if (idx !== undefined) {
        if (this.dom.stationDropdown) this.dom.stationDropdown.value = idx;
        this.selectStationByIndex(idx);
      }
    });

    window.addEventListener("focus", () => {
      console.log("🔄 Window focused. Checking if list needs refresh...");

      if (
        currentUserCoords &&
        this.dom.dropdown?.value &&
        (!this.dom.stationList || this.dom.stationList.children.length === 0)
      ) {
        console.log("⚡ Station list is empty on focus. Repopulating...");
        this.updateStations(false);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        console.log("💤 Tab hidden, stopping background polling.");
        this.stopPolling();
      } else {
        console.log("👀 Tab visible again. Forcing data update...");
        if (currentUserCoords && this.dom.dropdown?.value) {
          this.updateStations(false);
          this.startPolling();
        }
      }
    });
  }
  //anotherhelper to rendor error
  renderErrorBanner(message, retryCallback) {
    if (!this.dom.stationList) return;
    this.dom.stationList.innerHTML = "";

    const li = document.createElement("li");
    li.className = "error-banner-item";
    li.style.cssText =
      "display: flex; flex-direction: column; align-items: center; padding: 20px; background-color: #fdf2f2; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24; text-align: center; gap: 10px;";

    li.innerHTML = `
      <span>⚠️ ${message}</span>
      <button type="button" class="retry-btn" style="padding: 8px 16px; background-color: #d9534f; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
        Retry Request
      </button>
    `;

    const retryBtn = li.querySelector(".retry-btn");
    retryBtn.addEventListener("click", () => {
      if (typeof retryCallback === "function") {
        retryCallback();
      }
    });

    this.dom.stationList.appendChild(li);
    this.speak(`Error: ${message}. Press retry to try again.`);
  }

  selectStationByIndex(idx) {
    if (idx === "" || idx === undefined) {
      this.updateDOM({ stationDetails: "", showDirections: false });
      return;
    }

    const station = this.currentStationsData[idx];
    if (station?.latitude && station?.longitude) {
      const time = new Date().toLocaleTimeString();
      const sortKey =
        this.dom.dropdown?.value === "option1" ? "empty_slots" : "free_bikes";
      const metricLabel =
        sortKey === "empty_slots" ? "Empty Docks" : "Free Bikes";

      const detailsText = `Selected station: ${station.name}. ${metricLabel}: ${station[sortKey] ?? 0}. Updated at ${time}`;

      this.updateDOM({
        searchStatus: { text: "", color: "" },
        stationDetails: detailsText,
        showDirections: true,
      });

      const detailsEl = this.dom.stationDetails;
      if (detailsEl) {
        detailsEl.classList.remove("updated");
        void detailsEl.offsetWidth; // Force browser reflow
        detailsEl.classList.add("updated");
      }
      this.speak(detailsText);
      showRouteToStation(station, sortKey);
    } else {
      this.updateDOM({ stationDetails: "", showDirections: false });
    }
  }

  async startLocationBoot() {
    this.updateDOM({
      status: {
        text: "Requesting location access to find nearby stations.",
        color: "#666",
      },
    });
    const coords = await UserLocation.displayUserCoordinates();

    if (!coords) {
      this.updateDOM({
        status: {
          text: "Location access denied. Please use the city search below.",
          color: "#d9534f",
        },
        showSearch: true,
      });
      return;
    }

    currentUserCoords = coords;
    this.updateDOM({
      status: {
        text: "Location acquired. Select an option above to find stations.",
        color: "green",
      },
      showSearch: false,
    });

    if (this.dom.dropdown?.value) this.updateStations(true);
    this.startPolling();
  }

  async updateStations(isManual) {
    if (!currentUserCoords) {
      this.updateDOM({
        status: {
          text: "Location access required. Use City Search.",
          color: "#d9534f",
        },
      });
      return;
    }

    if (!this.dom.dropdown?.value) {
      if (isManual) {
        this.updateDOM({
          status: {
            text: "Please select an option from the dropdown first.",
            color: "#d9534f",
          },
        });
      }
      return;
    }

    const sortKey =
      this.dom.dropdown.value === "option1" ? "empty_slots" : "free_bikes";

    if (isManual) {
      this.updateDOM({
        status: { text: "Fetching latest station data.", color: "#666" },
      });
    }

    // ⚡ SHOW SKELETONS IMMEDIATELY AT THE START
    this.renderSkeletonLoaders(4);

    try {
      const network = await NetworkService.getNearestNetwork(
        currentUserCoords.latitude,
        currentUserCoords.longitude,
      );

      if (!network) {
        this.updateDOM({
          status: {
            text: "No nearby bike-sharing network found.",
            color: "#d9534f",
          },
        });

        if (this.currentStationsData.length === 0) {
          this.renderErrorBanner(
            "No nearby bike-sharing network found or offline.",
            () => this.updateStations(true),
          );
        } else {
          this.renderStations(
            this.currentStationsData,
            sortKey,
            "Bike Network",
            false,
          );
        }
        return;
      }

      const bestStations = await DataHandler.fetchStations(
        network.id,
        currentUserCoords.latitude,
        currentUserCoords.longitude,
        sortKey,
        10,
      );
      const newHash = JSON.stringify(bestStations);

      // If automatic poll and nothing changed, restore the current list and exit
      if (
        !isManual &&
        newHash === this.cachedHash &&
        this.lastRenderedSortKey === sortKey
      ) {
        if (this.currentStationsData.length > 0) {
          this.renderStations(
            this.currentStationsData,
            sortKey,
            network.name,
            false,
          );
        }
        return;
      }

      this.cachedHash = newHash;
      this.lastRenderedSortKey = sortKey;
      this.currentStationsData = bestStations;

      this.renderStations(bestStations, sortKey, network.name, isManual);
    } catch (error) {
      console.error(error);
      this.updateDOM({
        status: { text: "Failed to update stations.", color: "#d9534f" },
      });

      // If we don't have cached data to fall back on, show the error banner with a retry option
      if (this.currentStationsData.length === 0) {
        this.renderErrorBanner(
          "Unable to fetch nearby station data. Please check your connection.",
          () => this.updateStations(true),
        );
      } else {
        // Fallback: restore current list on error so skeletons never stay stuck
        this.renderStations(
          this.currentStationsData,
          sortKey,
          "Bike Network",
          false,
        );
      }
    }
  }
  async handleSearchRefresh() {
    if (!this.currentNetworkId) {
      this.updateDOM({
        searchStatus: {
          text: "Please search for a city first.",
          color: "#d9534f",
        },
      });
      return;
    }

    this.updateDOM({
      searchStatus: { text: "Refreshing station data.", color: "#666" },
    });

    try {
      const networkDetails = await NetworkService.fetchNetworkDetails(
        this.currentNetworkId,
      );
      const prevSelection = this.dom.stationDropdown.value;
      this.populateStationDropdown(networkDetails);

      if (
        prevSelection !== "" &&
        this.dom.stationDropdown.options[prevSelection]
      ) {
        this.dom.stationDropdown.value = prevSelection;
        this.dom.stationDropdown.dispatchEvent(new Event("change"));
        this.updateDOM({
          searchStatus: {
            text: "Station data refreshed successfully.",
            color: "green",
          },
        });
      } else {
        this.updateDOM({
          searchStatus: {
            text: "Network data refreshed. Choose a station.",
            color: "green",
          },
        });
      }
    } catch (error) {
      console.error(error);
      this.updateDOM({
        searchStatus: {
          text: "Failed to refresh station data.",
          color: "#d9534f",
        },
      });

      // Show the error banner with a retry callback
      this.renderErrorBanner("Failed to refresh station list.", () =>
        this.handleSearchRefresh(),
      );
    }
  }

  renderStations(stations, sortKey, networkName, isManual = true) {
    if (this.currentSortKey !== sortKey) {
      this.previousMetrics.clear();
      this.currentSortKey = sortKey;
    }

    this.dom.stationList.innerHTML = "";
    this.dom.stationList.removeAttribute("role");
    const timeString = new Date().toLocaleTimeString();

    // ⚡ HANDLE ZERO STATIONS WITH AN ERROR/INFO BANNER
    if (stations.length === 0) {
      this.updateDOM({
        status: {
          text: `Connected to ${networkName}, but no stations are currently available.`,
          color: "#d9534f",
        },
      });

      this.renderErrorBanner(`No stations found for ${networkName}.`, () =>
        this.updateStations(true),
      );
      return;
    }

    this.updateDOM({
      status: {
        text: `Showing nearest stations for ${networkName}. Updated at ${timeString}`,
        color: "green",
      },
      showDirections: true,
    });

    const currentMetrics = new Map();

    stations.forEach((station, index) => {
      const li = document.createElement("li");
      li.className = "station-item";

      const metricLabel =
        sortKey === "empty_slots" ? "Empty Docks" : "Free Bikes";
      const metricValue = station[sortKey] ?? 0;
      const stationId = station.id || station.name;

      const previousValue = this.previousMetrics?.get(stationId);
      if (previousValue !== undefined && previousValue !== metricValue) {
        li.classList.add("data-changed");
      }

      currentMetrics.set(stationId, metricValue);

      const hasCoords = station.latitude && station.longitude;
      const distanceStr = station.distance
        ? `${station.distance.toFixed(1)} kilometers away`
        : "Distance unknown";

      const fullNarration = `Station ${index + 1}, ${station.name}, ${distanceStr}, ${metricLabel} ${metricValue}. Press Enter to show map route.`;
      li.setAttribute("aria-label", fullNarration);

      li.innerHTML = `
        <span class="station-text" aria-hidden="true">
          Station ${index + 1}: ${station.name}, ${distanceStr}, ${metricLabel}: ${metricValue}.
        </span>
        <button type="button" class="directions-btn gps-dir-btn" aria-hidden="true" tabindex="-1"
          ${hasCoords ? `data-index="${index}"` : "disabled"}>
          Show Map Route
        </button>
      `;

      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && hasCoords) {
          e.preventDefault();
          if (this.dom.stationDropdown) this.dom.stationDropdown.value = index;
          this.selectStationByIndex(index);
        }
      });

      this.dom.stationList.appendChild(li);
      setTimeout(() => {
        li.classList.add("appear");
      }, 10);
    });

    this.previousMetrics = currentMetrics;

    setTimeout(() => {
      initializeOrUpdateMap(stations, sortKey);
    }, 50);
  }
  renderSkeletonLoaders(count = 3) {
    if (!this.dom.stationList) return;
    this.dom.stationList.innerHTML = "";

    for (let i = 0; i < count; i++) {
      const li = document.createElement("li");
      li.className = "skeleton-card";
      li.innerHTML = `
        <div class="skeleton-content">
          <div class="skeleton-line long"></div>
          <div class="skeleton-line short"></div>
        </div>
        <div class="skeleton-btn"></div>
      `;
      this.dom.stationList.appendChild(li);
    }
  }

  async handleCitySearch(query) {
    const cleanQuery = query.trim().toLowerCase();
    if (this.dom.stationList) {
      this.dom.stationList.innerHTML = "";
    }
    if (!cleanQuery) {
      this.updateDOM({
        searchStatus: {
          text: "Please enter a city or network name first.",
          color: "#d9534f",
        },
      });
      return;
    }

    this.updateDOM({
      searchStatus: {
        text: `Searching for networks matching ${query}.`,
        color: "#666",
      },
      stationDetails: "",
      showStationSelect: false,
      showSearchRefresh: false,
      showDirections: false,
    });

    try {
      const networks = await NetworkService.fetchAllNetworks();
      const matched = networks.find((net) => {
        const city = net.location.city?.toLowerCase() || "";
        const name = net.name?.toLowerCase() || "";
        const id = net.id?.toLowerCase() || "";
        return (
          city.includes(cleanQuery) ||
          name.includes(cleanQuery) ||
          id.includes(cleanQuery)
        );
      });

      if (!matched) {
        this.updateDOM({
          searchStatus: {
            text: `No bike network found for ${query}.`,
            color: "#d9534f",
          },
        });

        // Optional: Show an error banner in the station list area for search too
        this.renderErrorBanner(
          `No bike network found for "${query}". Check spelling and try again. Or try a new network`,
          () => this.handleCitySearch(query),
        );
        return;
      }

      this.currentNetworkId = matched.id;
      this.updateDOM({
        searchStatus: {
          text: `Found network: ${matched.name}. Loading stations.`,
          color: "#666",
        },
      });

      const networkDetails = await NetworkService.fetchNetworkDetails(
        matched.id,
      );
      this.populateStationDropdown(networkDetails);
    } catch (error) {
      console.error(error);
      this.updateDOM({
        searchStatus: {
          text: "Failed to retrieve network or station data. Please check your connection.",
          color: "#d9534f",
        },
      });

      // Render the error banner with a retry bound to the search query
      this.renderErrorBanner(
        "Network request failed. Please check your connection and retry.",
        () => this.handleCitySearch(query),
      );
    }
  }
  populateStationDropdown(networkData) {
    const stations = networkData.stations || [];
    this.currentStationsData = stations;
    this.dom.stationDropdown.innerHTML =
      '<option value="">-- Choose a station --</option>';

    if (stations.length === 0) {
      this.updateDOM({
        searchStatus: {
          text: `Connected to ${networkData.name}, but no stations are currently available.`,
          color: "#d9534f",
        },
        showStationSelect: false,
        showSearchRefresh: true, // Keep refresh visible so they can try again
      });

      // Optionally, if you want the error banner to show up in the station list area too:
      if (this.dom.stationList) {
        this.renderErrorBanner(
          `No stations available for ${networkData.name}.`,
          () => this.handleSearchRefresh(),
        );
      }
      return;
    }

    this.updateDOM({
      searchStatus: { text: "Network loaded successfully.", color: "green" },
    });
    this.dom.networkTitle.textContent = `Select a station from ${networkData.name} (${stations.length} available):`;

    stations.forEach((station, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = station.name;
      this.dom.stationDropdown.appendChild(opt);
    });

    this.updateDOM({ showStationSelect: true, showSearchRefresh: true });
  }

  startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      if (currentUserCoords && this.dom.dropdown?.value) {
        this.updateStations(false);
      }
    }, 30000);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => new AppController());

// --- MAP & MARKER MANAGEMENT ---

function initializeOrUpdateMap(stations, sortKey) {
  const directionsContainer = document.getElementById("directionsContainer");
  directionsContainer.classList.remove("hidden");

  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.setAttribute("aria-hidden", "true");
  }

  if (!mapInstance) {
    const centerCoord = currentUserCoords
      ? [currentUserCoords.longitude, currentUserCoords.latitude]
      : [stations[0].longitude, stations[0].latitude];

    mapInstance = new maplibregl.Map({
      container: "map",
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "osm-tiles-layer",
            type: "raster",
            source: "osm-tiles",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: centerCoord,
      zoom: 13,
    });

    mapInstance.on("load", () => {
      renderAllStationMarkers(stations);
      updateUserMarker();
    });
  } else {
    mapInstance.resize();
    renderAllStationMarkers(stations);
    updateUserMarker();
  }
}

function renderAllStationMarkers(stations) {
  stationMarkers.forEach((m) => m.remove());
  stationMarkers = [];

  stations.forEach((station, index) => {
    if (!station.latitude || !station.longitude) return;

    const el = document.createElement("div");
    el.className = "map-station-pin";
    el.innerHTML = `<span>📍</span>`;
    el.style.cursor = "pointer";
    el.style.fontSize = "20px";

    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `Bike station: ${station.name}`);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([station.longitude, station.latitude])
      .addTo(mapInstance);

    const selectThisStation = () => {
      if (appControllerInstance) {
        if (appControllerInstance.dom.stationDropdown) {
          appControllerInstance.dom.stationDropdown.value = index;
        }
        appControllerInstance.selectStationByIndex(index);
      }
    };

    el.addEventListener("click", selectThisStation);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Space") {
        e.preventDefault();
        selectThisStation();
      }
    });

    stationMarkers.push(marker);
  });
}

function updateUserMarker() {
  if (!currentUserCoords) return;
  if (userMarker) {
    userMarker.setLngLat([
      currentUserCoords.longitude,
      currentUserCoords.latitude,
    ]);
  } else {
    userMarker = new maplibregl.Marker({ color: "#34A853" })
      .setLngLat([currentUserCoords.longitude, currentUserCoords.latitude])
      .addTo(mapInstance);
  }
}

async function showRouteToStation(station, sortKey) {
  const directionsContainer = document.getElementById("directionsContainer");
  const directionsHeader = document.getElementById("directionsHeader");

  directionsContainer.classList.remove("hidden");
  directionsContainer.setAttribute("role", "region");
  directionsContainer.setAttribute(
    "aria-label",
    `Route directions to ${station.name}`,
  );

  if (directionsHeader) {
    directionsHeader.textContent = `Route to: ${station.name}`;
  }

  if (!mapInstance) {
    const centerCoord = currentUserCoords
      ? [currentUserCoords.longitude, currentUserCoords.latitude]
      : [station.longitude, station.latitude];

    mapInstance = new maplibregl.Map({
      container: "map",
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "osm-tiles-layer",
            type: "raster",
            source: "osm-tiles",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: centerCoord,
      zoom: 13,
    });

    await new Promise((resolve) => mapInstance.on("load", resolve));
  } else {
    mapInstance.resize();
  }

  if (
    appControllerInstance &&
    appControllerInstance.currentStationsData.length > 0
  ) {
    renderAllStationMarkers(appControllerInstance.currentStationsData);
  }

  updateUserMarker();

  let routeCoordinates = currentUserCoords
    ? [
        [currentUserCoords.longitude, currentUserCoords.latitude],
        [station.longitude, station.latitude],
      ]
    : [[station.longitude, station.latitude]];

  if (currentUserCoords) {
    try {
      const profile = sortKey === "empty_slots" ? "cycling" : "foot";
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/${profile}/${currentUserCoords.longitude},${currentUserCoords.latitude};${station.longitude},${station.latitude}?overview=full&geometries=geojson`,
      );
      const data = await res.json();
      if (data.code === "Ok" && data.routes?.length > 0) {
        routeCoordinates = data.routes[0].geometry.coordinates;
      }
    } catch (e) {
      console.warn("Routing fallback applied:", e);
    }
  }

  const geojson = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: routeCoordinates },
  };

  if (mapInstance.getSource("route-source")) {
    mapInstance.getSource("route-source").setData(geojson);
  } else if (mapInstance.isStyleLoaded()) {
    mapInstance.addSource("route-source", { type: "geojson", data: geojson });
    mapInstance.addLayer({
      id: "route-line",
      type: "line",
      source: "route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#4285f4", "line-width": 5, "line-opacity": 0.75 },
    });
  }

  if (currentUserCoords) {
    mapInstance.flyTo({
      center: [
        (currentUserCoords.longitude + station.longitude) / 2,
        (currentUserCoords.latitude + station.latitude) / 2,
      ],
      zoom: 15,
    });
  } else {
    mapInstance.flyTo({
      center: [station.longitude, station.latitude],
      zoom: 15,
    });
  }

  directionsContainer.scrollIntoView({ behavior: "smooth" });

  if (directionsHeader) {
    directionsHeader.setAttribute("tabindex", "-1");
    setTimeout(() => {
      directionsHeader.focus();
    }, 250);
  }
}
