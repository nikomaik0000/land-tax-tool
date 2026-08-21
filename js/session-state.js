export function loadSessionState(key) {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveSessionState(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Unable to save session state: ${key}`, error);
    return false;
  }
}

export function clearSessionState(key) {
  sessionStorage.removeItem(key);
}
