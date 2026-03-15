import { getAuth } from 'firebase/auth';

// Firebase ID Token을 가져오는 헬퍼
export async function getIdToken() {
    const user = getAuth().currentUser;
    if (!user) return null;
    return user.getIdToken();
}

// Authorization 헤더를 포함한 fetch 래퍼
export async function authFetch(url, options = {}) {
    const token = await getIdToken();
    const headers = {
        ...options.headers,
        ...(token && { Authorization: `Bearer ${token}` }),
    };
    return fetch(url, { ...options, headers });
}

// axios용 Authorization 헤더 생성
export async function getAuthHeaders() {
    const token = await getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
