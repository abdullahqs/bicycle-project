export default class DistanceCalculator {
  /**
   * Calculates distance between two coordinates using the Haversine formula
   */
  static getDistanceInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    // Simplified
    const c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
  }

  /**
   * Filter and sort nearby stations based on availability
   * @param {number} userLat
   * @param {number} userLng
   * @param {Array} stationsList
   * @param {string} sortKey - "empty_slots" for return, "free_bikes" for pick up
   * @param {number} limit
   */
  static getBestStations(
    userLat,
    userLng,
    stationsList = [],
    sortKey = "free_bikes",
    limit = 10,
  ) {
    if (!Array.isArray(stationsList) || stationsList.length === 0) return [];

    return (
      stationsList
        // 1. Filter out unusable stations FIRST
        .filter((station) => (station[sortKey] ?? 0) > 0)
        // 2. Calculate distance for valid stations
        .map((station) => ({
          ...station,
          distance: this.getDistanceInKm(
            userLat,
            userLng,
            station.latitude,
            station.longitude,
          ),
        }))
        // 3. Sort by distance ascending
        .sort((a, b) => a.distance - b.distance)
        // 4. Return top N valid closest stations
        .slice(0, limit)
    );
  }
}
