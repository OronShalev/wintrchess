export default function apiUrl(path: string) {
    const backendUrl = (window.BACKEND_URL || "").replace(/\/$/, "");

    return `${backendUrl}${path}`;
}