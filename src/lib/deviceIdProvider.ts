const STORAGE_KEY = "lifeos_unique_device_id";

/**
 * Retrieves or generates a persistent Device ID for this Web PWA browser instance.
 * Example Output: "WEB_DEXIE_c4e190fd"
 */
export function getWebDeviceId(): string {
  let deviceId = localStorage.getItem(STORAGE_KEY);
  
  if (!deviceId) {
    const randomTag = Math.random().toString(36).substring(2, 10);
    deviceId = `WEB_DEXIE_${randomTag}`;
    localStorage.setItem(STORAGE_KEY, deviceId);
  }
  
  return deviceId;
}
