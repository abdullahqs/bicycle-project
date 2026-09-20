export default class MapManager {
  constructor() {
    this.mapInstance = null;
    this.stationMarkers = [];
    this.userMarker = null;
  }

  initializeOrUpdateMap(stations, sortKey, currentUserCoords, onStationSelect) {
    const directionsContainer = document.getElementById("directionsContainer");
    directionsContainer.classList.remove("hidden");

    const mapElement = document.getElementById("map");
    if (mapElement) mapElement.setAttribute("aria-hidden", "true");

    if (!this.mapInstance) {
      const centerCoord = currentUserCoords
        ? [currentUserCoords.longitude, currentUserCoords.latitude]
        : [stations[0].longitude, stations[0].latitude];

      this.mapInstance = new maplibregl.Map({
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

      this.mapInstance.on("load", () => {
        this.renderAllStationMarkers(
          stations,
          currentUserCoords,
          onStationSelect,
        );
        this.updateUserMarker(currentUserCoords);
      });
    } else {
      this.mapInstance.resize();
      this.renderAllStationMarkers(
        stations,
        currentUserCoords,
        onStationSelect,
      );
      this.updateUserMarker(currentUserCoords);
    }
  }

  renderAllStationMarkers(stations, currentUserCoords, onStationSelect) {
    this.stationMarkers.forEach((m) => m.remove());
    this.stationMarkers = [];

    stations.forEach((station, index) => {
      if (!station.latitude || !station.longitude) return;

      const el = document.createElement("div");
      el.className = "map-station-pin";
      el.innerHTML = `<span>📍</span>`;
      el.style.cssText = "cursor: pointer; font-size: 20px;";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", `Bike station: ${station.name}`);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([station.longitude, station.latitude])
        .addTo(this.mapInstance);

      const handleSelect = () => onStationSelect(index);

      el.addEventListener("click", handleSelect);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Space") {
          e.preventDefault();
          handleSelect();
        }
      });

      this.stationMarkers.push(marker);
    });
  }

  updateUserMarker(currentUserCoords) {
    if (!currentUserCoords || !this.mapInstance) return;
    if (this.userMarker) {
      this.userMarker.setLngLat([
        currentUserCoords.longitude,
        currentUserCoords.latitude,
      ]);
    } else {
      this.userMarker = new maplibregl.Marker({ color: "#34A853" })
        .setLngLat([currentUserCoords.longitude, currentUserCoords.latitude])
        .addTo(this.mapInstance);
    }
  }

  async showRouteToStation(
    station,
    sortKey,
    currentUserCoords,
    allStations,
    onStationSelect,
  ) {
    const directionsContainer = document.getElementById("directionsContainer");
    const directionsHeader = document.getElementById("directionsHeader");

    directionsContainer.classList.remove("hidden");
    directionsContainer.setAttribute("role", "region");
    directionsContainer.setAttribute(
      "aria-label",
      `Route directions to ${station.name}`,
    );

    if (directionsHeader)
      directionsHeader.textContent = `Route to: ${station.name}`;

    if (!this.mapInstance) {
      const centerCoord = currentUserCoords
        ? [currentUserCoords.longitude, currentUserCoords.latitude]
        : [station.longitude, station.latitude];

      this.mapInstance = new maplibregl.Map({
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

      await new Promise((resolve) => this.mapInstance.on("load", resolve));
    } else {
      this.mapInstance.resize();
    }

    if (allStations.length > 0) {
      this.renderAllStationMarkers(
        allStations,
        currentUserCoords,
        onStationSelect,
      );
    }
    this.updateUserMarker(currentUserCoords);

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

    if (this.mapInstance.getSource("route-source")) {
      this.mapInstance.getSource("route-source").setData(geojson);
    } else if (this.mapInstance.isStyleLoaded()) {
      this.mapInstance.addSource("route-source", {
        type: "geojson",
        data: geojson,
      });
      this.mapInstance.addLayer({
        id: "route-line",
        type: "line",
        source: "route-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#4285f4",
          "line-width": 5,
          "line-opacity": 0.75,
        },
      });
    }

    if (currentUserCoords) {
      this.mapInstance.flyTo({
        center: [
          (currentUserCoords.longitude + station.longitude) / 2,
          (currentUserCoords.latitude + station.latitude) / 2,
        ],
        zoom: 15,
      });
    } else {
      this.mapInstance.flyTo({
        center: [station.longitude, station.latitude],
        zoom: 15,
      });
    }

    directionsContainer.scrollIntoView({ behavior: "smooth" });
    if (directionsHeader) {
      directionsHeader.setAttribute("tabindex", "-1");
      setTimeout(() => directionsHeader.focus(), 250);
    }
  }
}
