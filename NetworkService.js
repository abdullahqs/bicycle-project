import DistanceCalculator from "./DistanceCalculator.js";

export default class NetworkService {
  // Define apiUrl as a STATIC property
  static apiUrl = "https://api.citybik.es/v2/networks";
  /**
   * Fetches the global list of all bike networks from the API
   */
  static async fetchAllNetworks() {
    try {
      const response = await fetch("https://api.citybik.es/v2/networks");
      const data = await response.json();
      return data.networks; // Returns the array of all global networks
    } catch (error) {
      console.error("Failed to fetch networks:", error);
      return []; // Return an empty array if the request fails
    }
  }
  /**
   * Fetches detailed data (including stations) for a specific network ID
   */
  static async fetchNetworkDetails(networkId) {
    try {
      const response = await fetch(
        `https://api.citybik.es/v2/networks/${networkId}`,
      );
      const data = await response.json();
      return data.network; // Returns the network object containing the stations array
    } catch (error) {
      console.error(`Failed to fetch network details for ${networkId}:`, error);
      return null;
    }
  }

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
