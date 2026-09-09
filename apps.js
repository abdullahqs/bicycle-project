import UserLocation from "./UserLocation.js";
import NetworkService from "./NetworkService.js";
import DataHandler from "./DataHandler.js";

export default class AppController {
  constructor() {
    this.cachedCoords = null;
    this.cachedHash = "";
    this.pollingInterval = null;
    this.currentStationsData = []; // Store stations in memory for dropdown lookups

    this.initDOM();
  }

  /**
   * Binds DOM elements and initializes the application lifecycle
   */
  initDOM() {
    this.dropdown = document.getElementById("toggle-choice");
    this.statusMessage = document.getElementById("status-message");
    this.stationList = document.getElementById("station-list");
    this.refreshBtn = document.getElementById("refresh-btn");

    // Search UI Elements
    this.searchSectionContainer = document.getElementById(
      "searchSectionContainer",
    );
    this.searchInput = document.getElementById("cityInput");
    this.searchBtn = document.getElementById("searchBtn");
    this.searchStatusMessage = document.getElementById("searchStatusMessage");

    this.stationSelectContainer = document.getElementById(
      "stationSelectContainer",
    );
    this.stationDropdown = document.getElementById("stationDropdown");
    this.selectedStationDetails = document.getElementById(
      "selectedStationDetails",
    );
    this.networkTitleLabel = document.getElementById("networkTitleLabel");

    // the google map start here
    this.directionsContainer = document.getElementById("directionsContainer");
    this.directionsBtn = document.getElementById("directionsBtn");

    this.bindEvents();
    this.startLocationBoot();
  }

  /**
   * Sets up all user interaction and visibility listeners
   */
  bindEvents() {
    this.dropdown?.addEventListener("change", () => this.updateStations(true));
    this.refreshBtn?.addEventListener("click", () => this.updateStations(true));

    // Search event listeners
    this.searchBtn?.addEventListener("click", () => {
      this.handleCitySearch(this.searchInput.value);
    });

    this.searchInput?.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        this.handleCitySearch(this.searchInput.value);
      }
    });

    // When the user picks a specific station from the search dropdown
    this.stationDropdown?.addEventListener("change", (event) => {
      const selectedIndex = event.target.value;

      if (selectedIndex === "") {
        if (this.selectedStationDetails)
          this.selectedStationDetails.innerHTML = "";
        if (this.directionsContainer)
          this.directionsContainer.style.display = "none";
        return;
      }

      const station = this.currentStationsData[selectedIndex];

      if (station) {
        if (this.selectedStationDetails) {
          this.selectedStationDetails.innerHTML = `
            📍 Station: ${station.name}<br>
            🚲 Free Bikes: ${station.free_bikes ?? 0}<br>
            🅿️ Empty Docks: ${station.empty_slots ?? 0}
          `;
        }

        // Check if we have valid coordinates for the station
        if (station.latitude && station.longitude) {
          let mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}&travelmode=bicycling`;

          if (this.cachedCoords) {
            mapsUrl += `&origin=${this.cachedCoords.latitude},${this.cachedCoords.longitude}`;
          }

          if (this.directionsBtn) this.directionsBtn.href = mapsUrl;
          if (this.directionsContainer)
            this.directionsContainer.style.display = "block";
        } else {
          if (this.directionsContainer)
            this.directionsContainer.style.display = "none";
        }
      } else {
        if (this.selectedStationDetails)
          this.selectedStationDetails.innerHTML = "";
        if (this.directionsContainer)
          this.directionsContainer.style.display = "none";
      }
    });

    // Pause polling when tab is hidden to save resources
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stopPolling();
      } else if (this.cachedCoords && this.dropdown?.value) {
        this.updateStations(false);
        this.startPolling();
      }
    });
  }
  /**
   * Handles the initial GPS permission prompt and startup sequence
   */
  async startLocationBoot() {
    this.setStatus(
      "Requesting location access to find nearby stations...",
      "#666",
    );
    const coords = await UserLocation.displayUserCoordinates();

    if (!coords) {
      // GPS DENIED: Display fallback search section and inform user
      this.setStatus(
        "⚠️ Location access denied. Please use the city search below.",
        "#d9534f",
      );
      if (this.searchSectionContainer) {
        this.searchSectionContainer.style.display = "block";
      }
      return;
    }

    // GPS ALLOWED: Keep search section hidden
    this.cachedCoords = coords;
    if (this.searchSectionContainer) {
      this.searchSectionContainer.style.display = "none";
    }

    this.setStatus(
      "Location acquired! Select an option above to find stations.",
      "green",
    );
    if (this.dropdown?.value) {
      this.updateStations(true);
    }
    this.startPolling();
  }

  /**
   * Helper to safely update the main status message
   */
  setStatus(message, color) {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
      this.statusMessage.style.color = color;
    }
  }

  /**
   * Helper to update the search-specific status message below the search input
   */
  setSearchStatus(message, color) {
    if (this.searchStatusMessage) {
      this.searchStatusMessage.textContent = message;
      this.searchStatusMessage.style.color = color || "#000";
    }
  }

  /**
   * Fetches networks, calculates distances, and updates GPS station view
   */
  async updateStations(isManual) {
    if (!this.cachedCoords) {
      this.setStatus(
        "⚠️ Location access is required for GPS features. Please use the City Search above instead.",
        "#d9534f",
      );
      return;
    }

    if (!this.dropdown?.value) return;

    const sortKey =
      this.dropdown.value === "option1" ? "empty_slots" : "free_bikes";

    if (isManual) {
      this.setStatus("Fetching latest station data...", "#666");
    }

    try {
      const network = await NetworkService.getNearestNetwork(
        this.cachedCoords.latitude,
        this.cachedCoords.longitude,
      );

      if (!network) {
        this.setStatus("⚠️ No nearby bike-sharing network found.", "#d9534f");
        return;
      }

      const bestStations = await DataHandler.fetchStations(
        network.id,
        this.cachedCoords.latitude,
        this.cachedCoords.longitude,
        sortKey,
        10,
      );

      const newHash = JSON.stringify(bestStations);
      if (!isManual && newHash === this.cachedHash) return;
      this.cachedHash = newHash;

      this.renderStations(bestStations, sortKey, network.name);
    } catch (error) {
      console.error("AppController Error:", error);
      this.setStatus(
        "⚠️ Failed to update stations. Please try again.",
        "#d9534f",
      );
    }
  }

  /**
   * Renders the GPS-based station list
   */
  renderStations(stations, sortKey, networkName) {
    this.stationList.innerHTML = "";
    const timeString = new Date().toLocaleTimeString();

    if (stations.length === 0) {
      this.setStatus(
        `Connected to ${networkName}. No stations match criteria.`,
        "#d9534f",
      );
      return;
    }

    this.setStatus(
      `Showing nearest stations for: ${networkName} | 🕒 Updated: ${timeString}`,
      "green",
    );

    stations.forEach((station, index) => {
      const li = document.createElement("li");
      li.style.padding = "10px";
      li.style.marginBottom = "6px";
      li.style.border = "1px solid #e0e0e0";
      li.style.borderRadius = "4px";
      // Build the Google Maps URL cleanly (supporting GPS origin if available, or just station destination)
      // Since updateStations already converted option1/option2 to true data keys:
      const metricLabel =
        sortKey === "empty_slots" ? "Empty Docks" : "Free Bikes";
      const metricValue = station[sortKey] ?? 0;
      let mapsUrl = "#";
      if (station.latitude && station.longitude) {
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}&travelmode=bicycling`;

        if (this.cachedCoords) {
          mapsUrl += `&origin=${this.cachedCoords.latitude},${this.cachedCoords.longitude}`;
        }
      }

      li.innerHTML = `
        <strong>${index + 1}. ${station.name}</strong><br>
        📍 Distance: <strong>${station.distance ? station.distance.toFixed(2) + " km" : "N/A"}</strong> | 
        🚲 ${metricLabel}: <strong>${metricValue}</strong><br>
        <a href="${mapsUrl}" target="_blank" style="display: inline-block; margin-top: 6px; padding: 4px 10px; background-color: #4285f4; color: white; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: bold;">
          🗺️ Get Cycling Directions
        </a>
      `;
      this.stationList.appendChild(li);
    });
  }

  /**
   * Handles text-based city searching as a fallback feature
   */
  async handleCitySearch(query) {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return;

    this.setSearchStatus(
      `Searching for networks matching "${query}"...`,
      "#666",
    );
    this.stationSelectContainer.style.display = "none";
    this.selectedStationDetails.innerHTML = "";

    try {
      const networks = await NetworkService.fetchAllNetworks();

      const matchedNetwork = networks.find((net) => {
        const cityName = net.location.city
          ? net.location.city.toLowerCase()
          : "";
        const networkName = net.name ? net.name.toLowerCase() : "";
        const networkId = net.id ? net.id.toLowerCase() : "";

        return (
          cityName.includes(cleanQuery) ||
          networkName.includes(cleanQuery) ||
          networkId.includes(cleanQuery)
        );
      });

      if (!matchedNetwork) {
        this.setSearchStatus(
          `⚠️ No bike network found for "${query}".`,
          "#d9534f",
        );
        return;
      }

      this.setSearchStatus(
        `Found network: ${matchedNetwork.name}. Loading stations...`,
        "#666",
      );

      const networkDetails = await NetworkService.fetchNetworkDetails(
        matchedNetwork.id,
      );
      this.populateStationDropdown(networkDetails);
    } catch (error) {
      console.error("Search error:", error);
      this.setSearchStatus("⚠️ Failed to retrieve station data.", "#d9534f");
    }
  }

  /**
   * Populates the station dropdown for the searched network
   */
  populateStationDropdown(networkData) {
    const stations = networkData.stations || [];
    this.currentStationsData = stations; // Store in memory
    this.stationDropdown.innerHTML =
      '<option value="">-- Choose a station --</option>';

    if (stations.length === 0) {
      this.setSearchStatus(
        `Connected to ${networkData.name}, but no stations are available.`,
        "#d9534f",
      );
      return;
    }

    this.setSearchStatus(`Network loaded successfully!`, "green");
    this.networkTitleLabel.textContent = `Select a station from ${networkData.name} (${stations.length} available):`;

    stations.forEach((station, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = station.name;
      this.stationDropdown.appendChild(option);
    });

    this.stationSelectContainer.style.display = "block";
  }

  /**
   * Starts background polling every 30 seconds
   */
  startPolling() {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      if (this.cachedCoords && this.dropdown?.value) {
        this.updateStations(false);
      }
    }, 30000);
  }

  /**
   * Clears background polling interval
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

// Automatically instantiate the application controller when DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  new AppController();
});
