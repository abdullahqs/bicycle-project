import DistanceCalculator from "./DistanceCalculator.js";

export default class DataHandler {
  static async fetchStations(networkId, userLat, userLng, sortKey, limit = 10) {
    try {
      const response = await fetch(
        `https://api.citybik.es/v2/networks/${networkId}`,
        {
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();
      const rawStations = data.network?.stations || [];

      // Delegate the math/sorting logic here instead of in apps.js
      return DistanceCalculator.getBestStations(
        userLat,
        userLng,
        rawStations,
        sortKey,
        limit,
      );
    } catch (error) {
      console.error("DataHandler Error:", error.message);
      return [];
    }
  }
}
