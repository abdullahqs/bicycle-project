import UserLocation from "./UserLocation.js";
import NetworkService from "./NetworkService.js";
import DataHandler from "./DataHandler.js";

export default class AppController {
  constructor() {
    this.cachedCoords = null;
    this.cachedHash = "";
    this.pollingInterval = null;

    this.initDOM();
  }

  /**
   * Binds DOM elements and initializes the event lifecycle
   */
  initDOM() {
    this.dropdown = document.getElementById("toggle-choice");
    this.statusMessage = document.getElementById("status-message");
    this.stationList = document.getElementById("station-list");
    this.refreshBtn = document.getElementById("refresh-btn");

    this.bindEvents();
    this.startLocationBoot();
  }

  /**
   * Sets up all user interaction and visibility listeners
   */
  bindEvents() {
    this.dropdown.addEventListener("change", () => this.updateStations(true));
    this.refreshBtn.addEventListener("click", () => this.updateStations(true));

    // Pause polling when tab is hidden to save battery/network bandwidth
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
      this.setStatus(
        "⚠️ Location access denied. Please enable GPS.",
        "#d9534f",
      );
      return;
    }

    this.cachedCoords = coords;
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
   * Helper to safely update status text and color
   */
  setStatus(message, color) {
    if (this.statusMessage) {
      this.statusMessage.textContent = message;
      this.statusMessage.style.color = color;
    }
  }

  /**
   * Fetches networks, calculates distances, and updates UI
   */
  async updateStations(isManual) {
    if (!this.cachedCoords || !this.dropdown?.value) return;

    // Determine sort strategy based on dropdown selection
    const sortKey =
      this.dropdown.value === "option1" ? "empty_slots" : "free_bikes";

    if (isManual) {
      this.setStatus("Fetching latest station data...", "#666");
    }

    try {
      // 1. Find nearest network based on current GPS
      const network = await NetworkService.getNearestNetwork(
        this.cachedCoords.latitude,
        this.cachedCoords.longitude,
      );

      if (!network) {
        this.setStatus("⚠️ No nearby bike-sharing network found.", "#d9534f");
        return;
      }

      // 2. Fetch live station feed for that network
      const bestStations = await DataHandler.fetchStations(
        network.id,
        this.cachedCoords.latitude,
        this.cachedCoords.longitude,
        sortKey,
        10,
      );
      // 3. Smart hash check: skip DOM updates during polling if data hasn't changed
      const newHash = JSON.stringify(bestStations);
      if (!isManual && newHash === this.cachedHash) {
        return;
      }
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
   * Renders the processed list of stations to the DOM
   */
  renderStations(stations, sortKey, networkName) {
    this.stationList.innerHTML = "";

    // Generate current timestamp
    const timeString = new Date().toLocaleTimeString();

    if (stations.length === 0) {
      this.setStatus(
        `Connected to ${networkName}. No stations currently match your criteria. (Last checked: ${timeString})`,
        "#d9534f",
      );
      return;
    }

    // Display network name along with the refresh timestamp
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

      const metricLabel =
        sortKey === "empty_slots" ? "Empty Docks" : "Free Bikes";
      const metricValue = station[sortKey] ?? 0;

      li.innerHTML = `
        <strong>${index + 1}. ${station.name}</strong><br>
        📍 Distance: <strong>${station.distance.toFixed(2)} km</strong> | 
        🚲 ${metricLabel}: <strong>${metricValue}</strong>
      `;
      this.stationList.appendChild(li);
    });
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
