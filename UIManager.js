export default class UIManager {
  constructor() {
    this.initDOM();
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
    this.setupScreenReaderAnnouncer();
  }

  setupScreenReaderAnnouncer() {
    let announcer = document.getElementById("sr-announcer");
    if (!announcer) {
      announcer = document.createElement("div");
      announcer.id = "sr-announcer";
      announcer.setAttribute("aria-live", "polite");
      announcer.setAttribute("aria-atomic", "true");
      announcer.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
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
      if (state.status.text) this.speak(state.status.text);
    }

    if (state.searchStatus !== undefined && this.dom.searchStatus) {
      this.dom.searchStatus.textContent = state.searchStatus.text || "";
      this.dom.searchStatus.style.color = state.searchStatus.color || "#000";
      if (state.searchStatus.text) this.speak(state.searchStatus.text);
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

    li.querySelector(".retry-btn").addEventListener("click", () => {
      if (typeof retryCallback === "function") retryCallback();
    });

    this.dom.stationList.appendChild(li);
    this.speak(`Error: ${message}. Press retry to try again.`);
  }
}
