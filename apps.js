import UserLocation from "./UserLocation.js";
import NetworkService from "./NetworkService.js";
import DataHandler from "./DataHandler.js";

export default class AppController {
  constructor() {
    this.cachedCoords = null;
    this.cachedHash = "";
    this.pollingInterval = null;
    this.currentStationsData = []; // Store stations in memory for dropdown lookups
    this.currentNetworkId = null;
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
    this.searchRefreshBtn = document.getElementById("searchRefreshBtn");

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

    // Google map / directions elements
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
    this.searchRefreshBtn?.addEventListener("click", () =>
      this.handleSearchRefresh(),
    );

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
          this.directionsContainer.classList.add("hidden");
        return;
      }

      const station = this.currentStationsData[selectedIndex];

      if (station) {
        const timeString = new Date().toLocaleTimeString();
        this.setSearchStatus("", "");
        if (this.selectedStationDetails) {
          this.selectedStationDetails.innerHTML = `
            📍 Station: ${station.name}<br>
            🚲 Free Bikes: ${station.free_bikes ?? 0}<br>
            🅿️ Empty Docks: ${station.empty_slots ?? 0} <br>
            🕒 Updated: ${timeString}
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
            this.directionsContainer.classList.remove("hidden");
        } else {
          if (this.directionsContainer)
            this.directionsContainer.classList.add("hidden");
        }
      } else {
        if (this.selectedStationDetails)
          this.selectedStationDetails.innerHTML = "";
        if (this.directionsContainer)
          this.directionsContainer.classList.add("hidden");
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
      // GPS DENIED: Display fallback search section and inform user using .hidden class
      this.setStatus(
        "⚠️ Location access denied. Please use the city search below.",
        "#d9534f",
      );
      if (this.searchSectionContainer) {
        this.searchSectionContainer.classList.remove("hidden");
      }
      return;
    }

    // GPS ALLOWED: Keep search section hidden
    this.cachedCoords = coords;
    if (this.searchSectionContainer) {
      this.searchSectionContainer.classList.add("hidden");
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

    if (!this.dropdown?.value) {
      if (isManual) {
        this.setStatus(
          "⚠️ Please select an option from the dropdown first.",
          "#d9534f",
        );
      }
      return;
    }

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
   * Refreshes station data specifically for the active City Search network
   */
  async handleSearchRefresh() {
    if (!this.currentNetworkId) {
      this.setSearchStatus("⚠️ Please search for a city first.", "#d9534f");
      return;
    }

    this.setSearchStatus("Refreshing station data...", "#666");
    try {
      const networkDetails = await NetworkService.fetchNetworkDetails(
        this.currentNetworkId,
      );

      // Remember user's current dropdown selection
      const previousSelection = this.stationDropdown.value;

      this.populateStationDropdown(networkDetails);

      // Restore their selection if it still exists in the refreshed list
      if (
        previousSelection !== "" &&
        this.stationDropdown.options[previousSelection]
      ) {
        this.stationDropdown.value = previousSelection;
        this.stationDropdown.dispatchEvent(new Event("change"));
        //  If a station was selected, show this message:
        this.setSearchStatus("Station data refreshed successfully!", "green");
      } else {
        //  If no station was chosen yet, show a more helpful message:
        this.setSearchStatus(
          "Network data refreshed! Please choose a station from the dropdown.",
          "green",
        );
      }
    } catch (error) {
      console.error("Search refresh error:", error);
      this.setSearchStatus("⚠️ Failed to refresh station data.", "#d9534f");
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
      li.className = "station-item"; // Clean class assignment

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
        🚲 ${metricLabel}: <strong>${metricValue}</strong>
        <a href="${mapsUrl}" target="_blank" class="directions-btn">
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
    if (!cleanQuery) {
      this.setSearchStatus(
        "⚠️ Please enter a city or network name first.",
        "#d9534f",
      );
      return;
    }

    this.setSearchStatus(
      `Searching for networks matching "${query}"...`,
      "#666",
    );
    this.stationSelectContainer.classList.add("hidden");
    this.selectedStationDetails.innerHTML = "";
    // Hide the search refresh button during a new search
    if (this.searchRefreshBtn) {
      this.searchRefreshBtn.classList.add("hidden");
    }
    if (this.directionsContainer) {
      this.directionsContainer.classList.add("hidden");
    }
    if (this.directionsBtn) {
      this.directionsBtn.href = "#";
    }

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

      this.currentNetworkId = matchedNetwork.id;

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

    this.stationSelectContainer.classList.remove("hidden");
    //Reveal the search refresh button now that a network is loaded
    if (this.searchRefreshBtn) {
      this.searchRefreshBtn.classList.remove("hidden");
    }
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
