import UserLocation from "./UserLocation.js";
import NetworkService from "./NetworkService.js";
import DataHandler from "./DataHandler.js";
import UIManager from "./UIManager.js";
import MapManager from "./MapManager.js";

export default class AppController {
  constructor() {
    this.ui = new UIManager();
    this.mapManager = new MapManager();

    this.currentUserCoords = null;
    this.cachedHash = "";
    this.pollingInterval = null;
    this.currentStationsData = [];
    this.currentNetworkId = null;
    this.lastRenderedSortKey = null;
    this.previousMetrics = new Map();

    window.debugAppController = this;
    this.init();
  }

  init() {
    this.bindEvents();
    this.startLocationBoot();
  }

  bindEvents() {
    const handleUpdate = (e) => {
      this.updateStations(true);
      if (e.target === this.ui.dom.dropdown) {
        this.ui.dom.dropdown.focus();
      }
    };

    this.ui.dom.dropdown?.addEventListener("change", handleUpdate);
    this.ui.dom.refreshBtn?.addEventListener("click", () =>
      this.updateStations(true),
    );
    this.ui.dom.searchRefreshBtn?.addEventListener("click", () =>
      this.handleSearchRefresh(),
    );

    this.ui.dom.searchBtn?.addEventListener("click", () =>
      this.handleCitySearch(this.ui.dom.searchInput.value),
    );

    this.ui.dom.searchInput?.addEventListener("keypress", (e) => {
      if (e.key === "Enter")
        this.handleCitySearch(this.ui.dom.searchInput.value);
    });

    this.ui.dom.searchInput?.addEventListener("input", () => {
      if (this.ui.dom.stationList) this.ui.dom.stationList.innerHTML = "";
      this.ui.updateDOM({ searchStatus: { text: "", color: "#666" } });
    });

    this.ui.dom.stationDropdown?.addEventListener("change", (e) => {
      this.selectStationByIndex(e.target.value);
    });

    this.ui.dom.stationList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".gps-dir-btn");
      if (!btn) return;
      const idx = btn.dataset.index;
      if (idx !== undefined) {
        if (this.ui.dom.stationDropdown)
          this.ui.dom.stationDropdown.value = idx;
        this.selectStationByIndex(idx);
      }
    });

    window.addEventListener("focus", () => {
      if (
        this.currentUserCoords &&
        this.ui.dom.dropdown?.value &&
        (!this.ui.dom.stationList ||
          this.ui.dom.stationList.children.length === 0)
      ) {
        this.updateStations(false);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stopPolling();
      } else {
        if (this.currentUserCoords && this.ui.dom.dropdown?.value) {
          this.updateStations(false);
          this.startPolling();
        }
      }
    });
  }

  selectStationByIndex(idx) {
    if (idx === "" || idx === undefined) {
      this.ui.updateDOM({ stationDetails: "", showDirections: false });
      return;
    }

    const station = this.currentStationsData[idx];
    if (station?.latitude && station?.longitude) {
      const time = new Date().toLocaleTimeString();
      const sortKey =
        this.ui.dom.dropdown?.value === "option1"
          ? "empty_slots"
          : "free_bikes";
      const metricLabel =
        sortKey === "empty_slots" ? "Empty Docks" : "Free Bikes";

      // Clean the station name for both display and speech so symbols/periods don't break things
      const cleanName = (station.name || "")
        .replace(/\bSt\./g, "Street")
        .replace(/\bAve\./g, "Avenue")
        .replace(/\bRd\./g, "Road")
        .replace(/\bBlvd\./g, "Boulevard")
        .replace(/\bHwy\./g, "Highway")
        .replace(/\bHwy\b/g, "Highway")
        .replace(/\bDr\./g, "Drive")
        .replace(/\bCt\./g, "Court")
        .replace(/\bLn\./g, "Lane")
        .replace(/&/g, " and ");

      const detailsText = `Selected station: ${cleanName}. ${metricLabel}: ${station[sortKey] ?? 0}. Updated at ${time}`;

      this.ui.updateDOM({
        searchStatus: { text: "", color: "" },
        stationDetails: detailsText,
        showDirections: true,
      });

      const detailsEl = this.ui.dom.stationDetails;
      if (detailsEl) {
        detailsEl.classList.remove("updated");
        void detailsEl.offsetWidth;
        detailsEl.classList.add("updated");
      }

      this.ui.speak(detailsText);

      // Delay map route slightly so the speech and DOM settle without stealing focus instantly
      setTimeout(() => {
        this.mapManager.showRouteToStation(
          station,
          sortKey,
          this.currentUserCoords,
          this.currentStationsData,
          (index) => {
            if (this.ui.dom.stationDropdown)
              this.ui.dom.stationDropdown.value = index;
            this.selectStationByIndex(index);
          },
        );
      }, 2000);
    } else {
      this.ui.updateDOM({ stationDetails: "", showDirections: false });
    }
  }

  async startLocationBoot() {
    this.ui.updateDOM({
      status: {
        text: "Requesting location access to find nearby stations.",
        color: "#666",
      },
    });
    const coords = await UserLocation.displayUserCoordinates();

    if (!coords) {
      this.ui.updateDOM({
        status: {
          text: "Location access denied. Please use the city search below.",
          color: "#d9534f",
        },
        showSearch: true,
      });
      return;
    }

    this.currentUserCoords = coords;
    this.ui.updateDOM({
      status: {
        text: "Location acquired. Select an option above to find stations.",
        color: "green",
      },
      showSearch: false,
    });

    if (this.ui.dom.dropdown?.value) this.updateStations(true);
    this.startPolling();
  }

  async updateStations(isManual) {
    this.isLastActionManual = isManual;
    if (!this.currentUserCoords) {
      this.ui.updateDOM({
        status: {
          text: "Location access required. Use City Search.",
          color: "#d9534f",
        },
      });
      return;
    }

    if (!this.ui.dom.dropdown?.value) {
      if (isManual) {
        this.ui.updateDOM({
          status: {
            text: "Please select an option from the dropdown first.",
            color: "#d9534f",
          },
        });
      }
      return;
    }

    const sortKey =
      this.ui.dom.dropdown.value === "option1" ? "empty_slots" : "free_bikes";

    if (isManual) {
      this.ui.updateDOM({
        status: { text: "Fetching latest station data.", color: "#666" },
      });
    }
    if (isManual || this.currentStationsData.length === 0) {
      this.ui.renderSkeletonLoaders(4);
    }

    try {
      const network = await NetworkService.getNearestNetwork(
        this.currentUserCoords.latitude,
        this.currentUserCoords.longitude,
      );

      if (!network) {
        this.ui.updateDOM({
          status: {
            text: "No nearby bike-sharing network found.",
            color: "#d9534f",
          },
        });

        if (this.currentStationsData.length === 0) {
          this.ui.renderErrorBanner(
            "No nearby bike-sharing network found or offline.",
            () => this.updateStations(true),
          );
        } else {
          this.renderStations(
            this.currentStationsData,
            sortKey,
            "Bike Network",
          );
        }
        return;
      }

      const bestStations = await DataHandler.fetchStations(
        network.id,
        this.currentUserCoords.latitude,
        this.currentUserCoords.longitude,
        sortKey,
        10,
      );

      const simplifiedData = bestStations
        .map((s) => ({
          id: s.id || s.name,
          value: s[sortKey],
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

      const newHash = JSON.stringify(simplifiedData);

      // STRICT CHECK: If it's a background poll (!isManual), and hash + sortKey match, abort completely!
      if (
        !isManual &&
        newHash === this.cachedHash &&
        this.lastRenderedSortKey === sortKey
      ) {
        console.log(
          "Polling check: Station data is identical. Skipping re-render.",
        );
        this.renderStations(this.currentStationsData, sortKey, "Bike Network");
        return;
      }

      this.cachedHash = newHash;
      this.lastRenderedSortKey = sortKey;
      this.currentStationsData = bestStations;

      this.renderStations(bestStations, sortKey, network.name);
    } catch (error) {
      console.error(error);
      this.ui.updateDOM({
        status: { text: "Failed to update stations.", color: "#d9534f" },
      });

      if (this.currentStationsData.length === 0) {
        this.ui.renderErrorBanner(
          "Unable to fetch nearby station data. Please check your connection.",
          () => this.updateStations(true),
        );
      } else {
        this.renderStations(this.currentStationsData, sortKey, "Bike Network");
      }
    }
  }

  renderStations(stations, sortKey, networkName) {
    if (this.currentSortKey !== sortKey) {
      this.previousMetrics.clear();
      this.currentSortKey = sortKey;
    }

    this.ui.dom.stationList.innerHTML = "";
    this.ui.dom.stationList.removeAttribute("role");
    const timeString = new Date().toLocaleTimeString();

    if (stations.length === 0) {
      this.ui.updateDOM({
        status: {
          text: `Connected to ${networkName}, but no stations are currently available.`,
          color: "#d9534f",
        },
      });
      this.ui.renderErrorBanner(`No stations found for ${networkName}.`, () =>
        this.updateStations(true),
      );
      return;
    }

    this.ui.updateDOM({
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

      // Clean the station name so raw symbols like '&' and abbreviations don't crash the screen reader
      const cleanName = (station.name || "")
        .replace(/\bSt\./g, "Street")
        .replace(/\bAve\./g, "Avenue")
        .replace(/\bRd\./g, "Road")
        .replace(/\bBlvd\./g, "Boulevard")
        .replace(/\bHwy\./g, "Highway")
        .replace(/\bHwy\b/g, "Highway")
        .replace(/\bDr\./g, "Drive")
        .replace(/\bCt\./g, "Court")
        .replace(/\bLn\./g, "Lane")
        .replace(/&/g, " and ");

      li.setAttribute(
        "aria-label",
        `Station ${index + 1}, ${cleanName}, ${distanceStr}, ${metricLabel} ${metricValue}. Press Enter to show map route.`,
      );

      li.innerHTML = `
        <span class="station-text" aria-hidden="true">
          Station ${index + 1}: ${cleanName}, ${distanceStr}, ${metricLabel}: ${metricValue}.
        </span>
        <button type="button" class="directions-btn gps-dir-btn" aria-hidden="true" tabindex="-1"
          ${hasCoords ? `data-index="${index}"` : "disabled"}>
          Show Map Route
        </button>
      `;

      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && hasCoords) {
          e.preventDefault();
          if (this.ui.dom.stationDropdown)
            this.ui.dom.stationDropdown.value = index;
          this.selectStationByIndex(index);
        }
      });

      this.ui.dom.stationList.appendChild(li);
      if (this.isLastActionManual) {
        setTimeout(() => li.classList.add("appear"), 10);
      } else {
        li.classList.add("appear");
      }
    });

    this.previousMetrics = currentMetrics;

    setTimeout(() => {
      this.mapManager.initializeOrUpdateMap(
        stations,
        sortKey,
        this.currentUserCoords,
        (index) => {
          if (this.ui.dom.stationDropdown)
            this.ui.dom.stationDropdown.value = index;
          this.selectStationByIndex(index);
        },
      );
    }, 50);
  }
  async handleCitySearch(query) {
    const cleanQuery = query.trim().toLowerCase();
    if (this.ui.dom.stationList) this.ui.dom.stationList.innerHTML = "";
    if (!cleanQuery) {
      this.ui.updateDOM({
        searchStatus: {
          text: "Please enter a city or network name first.",
          color: "#d9534f",
        },
      });
      return;
    }

    this.ui.updateDOM({
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
        this.ui.updateDOM({
          searchStatus: {
            text: `No bike network found for ${query}.`,
            color: "#d9534f",
          },
        });
        this.ui.renderErrorBanner(
          `No bike network found for "${query}". Check spelling and try again.`,
          () => this.handleCitySearch(query),
        );
        return;
      }

      this.currentNetworkId = matched.id;
      this.ui.updateDOM({
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
      this.ui.updateDOM({
        searchStatus: {
          text: "Failed to retrieve network or station data.",
          color: "#d9534f",
        },
      });
      this.ui.renderErrorBanner(
        "Network request failed. Please check your connection.",
        () => this.handleCitySearch(query),
      );
    }
  }

  async handleSearchRefresh() {
    if (!this.currentNetworkId) {
      this.ui.updateDOM({
        searchStatus: {
          text: "Please search for a city first.",
          color: "#d9534f",
        },
      });
      return;
    }

    this.ui.updateDOM({
      searchStatus: { text: "Refreshing station data.", color: "#666" },
    });

    try {
      const networkDetails = await NetworkService.fetchNetworkDetails(
        this.currentNetworkId,
      );
      const prevSelection = this.ui.dom.stationDropdown.value;
      this.populateStationDropdown(networkDetails);

      if (
        prevSelection !== "" &&
        this.ui.dom.stationDropdown.options[prevSelection]
      ) {
        this.ui.dom.stationDropdown.value = prevSelection;
        this.ui.dom.stationDropdown.dispatchEvent(new Event("change"));
        this.ui.updateDOM({
          searchStatus: {
            text: "Station data refreshed successfully.",
            color: "green",
          },
        });
      } else {
        this.ui.updateDOM({
          searchStatus: {
            text: "Network data refreshed. Choose a station.",
            color: "green",
          },
        });
      }
    } catch (error) {
      console.error(error);
      this.ui.updateDOM({
        searchStatus: {
          text: "Failed to refresh station data.",
          color: "#d9534f",
        },
      });
      this.ui.renderErrorBanner("Failed to refresh station list.", () =>
        this.handleSearchRefresh(),
      );
    }
  }

  populateStationDropdown(networkData) {
    const stations = networkData.stations || [];
    this.currentStationsData = stations;
    this.ui.dom.stationDropdown.innerHTML =
      '<option value="">-- Choose a station --</option>';

    if (stations.length === 0) {
      this.ui.updateDOM({
        searchStatus: {
          text: `Connected to ${networkData.name}, but no stations are currently available.`,
          color: "#d9534f",
        },
        showStationSelect: false,
        showSearchRefresh: true,
      });

      if (this.ui.dom.stationList) {
        this.ui.renderErrorBanner(
          `No stations available for ${networkData.name}.`,
          () => this.handleSearchRefresh(),
        );
      }
      return;
    }

    this.ui.updateDOM({
      searchStatus: { text: "Network loaded successfully.", color: "green" },
    });
    this.ui.dom.networkTitle.textContent = `Select a station from ${networkData.name} (${stations.length} available):`;

    stations.forEach((station, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.textContent = station.name;
      this.ui.dom.stationDropdown.appendChild(opt);
    });

    this.ui.updateDOM({ showStationSelect: true, showSearchRefresh: true });
  }

  startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      if (this.currentUserCoords && this.ui.dom.dropdown?.value) {
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
