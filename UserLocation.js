export default class UserLocation {
  static getUserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by your browser"));
        return;
      }

      // Added options for faster response and fallback handling
      const options = {
        enableHighAccuracy: true,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          reject(new Error(`Location error: ${error.message}`));
        },
        options,
      );
    });
  }

  static async displayUserCoordinates() {
    try {
      console.log("Requesting permission for location...");
      const coords = await this.getUserLocation();

      console.log("Latitude:", coords.latitude);
      console.log("Longitude:", coords.longitude);
      return coords;
    } catch (error) {
      console.warn("Location prompt failed/rejected:", error.message);
      return null; // Consistently return null so apps.js can handle the UI status message
    }
  }
}
