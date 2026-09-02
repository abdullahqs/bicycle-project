import DistanceCalculator from "./DistanceCalculator.js";

export default class NetworkService {
  // Define apiUrl as a STATIC property
  static apiUrl = "https://api.citybik.es/v2/networks";

  static async getNearestNetwork(
    userLat,
    userLng,
    apiUrl = NetworkService.apiUrl,
  ) {
    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();

      // Filter networks with valid location coordinates
      const validNetworks = data.networks.filter(
        (net) =>
          net.location &&
          net.location.latitude != null &&
          net.location.longitude != null,
      );

      // Sort networks by distance to user
      const sortedNetworks = validNetworks
        .map((net) => ({
          ...net,
          distance: DistanceCalculator.getDistanceInKm(
            userLat,
            userLng,
            net.location.latitude,
            net.location.longitude,
          ),
        }))
        .sort((a, b) => a.distance - b.distance);

      return sortedNetworks[0] || null;
    } catch (error) {
      console.error("NetworkService Error:", error.message);
      return null;
    }
  }
}
