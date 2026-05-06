// 신규 기능 "확인 여부" 추적 — localStorage(즉시) + Firestore(크로스기기) 하이브리드
// 사용 예: const { seen, markSeen } = useFeatureSeen(uid, 'notifications');
//
// NEW 뱃지 자동 스킵 정책:
// 1. 온보딩 완료 시점에 featuresSeen.{key}=true를 Firestore에 직접 설정 (신규 유저 대응) — 구현됨
// 2. 향후: users.firstNativePlatform 별로 FEATURE_LAUNCH_VERSIONS 비교 자동 스킵 (미구현)
//    예: { notifications: { android: '1.2.7', ios: '1.2.4' } }
//    iOS/Android가 독립된 스토어 버전이므로 플랫폼별로 launch 버전이 다름 — 플랫폼 구분 필수
import { useCallback, useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { db } from '../firebase/config';

const LS_PREFIX = 'pronunfit.featureSeen.';

// 플랫폼별 기능 최소 지원 버전 — 새 기능 추가 시 여기에 등록
// iOS 1.3.0: Push Notifications 네이티브 통합 빌드 (APNs token forwarding + entitlements + SPM 등록)
export const FEATURE_LAUNCH_VERSIONS = {
    notifications: { android: '1.2.7', ios: '1.3.0' },
};

// semver 스타일 버전 비교 ("1.2.10" > "1.2.9" 정확히 판정)
function compareVersions(a, b) {
    if (!a || !b) return 0;
    const aParts = a.split('.').map(n => parseInt(n, 10) || 0);
    const bParts = b.split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
        const av = aParts[i] || 0;
        const bv = bParts[i] || 0;
        if (av !== bv) return av - bv;
    }
    return 0;
}

// 현재 유저의 플랫폼 + 네이티브 버전이 해당 기능을 지원하는지
// - 웹 유저: true (UI는 보여주되 토글은 isNative 가드로 disabled)
// - 네이티브 유저: firstNativeVersion을 기준으로 비교 (앱 실행 시 업데이트됨)
// - iOS는 null이면 false (미출시)
export function supportsFeature(featureKey, profile) {
    if (!Capacitor.isNativePlatform?.()) return true; // 웹은 항상 렌더 (내부 가드 존재)
    const platform = profile?.currentNativePlatform;
    if (!platform) return false; // 플랫폼 미기록 (신규 유저 첫 로드 구간) → 안전하게 false
    const launchMap = FEATURE_LAUNCH_VERSIONS[featureKey];
    const requiredVersion = launchMap?.[platform];
    if (!requiredVersion) return false; // 해당 플랫폼 미출시
    const currentVersion = profile?.currentNativeVersion;
    if (!currentVersion) return false;
    return compareVersions(currentVersion, requiredVersion) >= 0;
}

function readLocal(key) {
    try {
        return localStorage.getItem(LS_PREFIX + key) === 'true';
    } catch {
        return false;
    }
}

function writeLocal(key, value) {
    try {
        localStorage.setItem(LS_PREFIX + key, value ? 'true' : 'false');
    } catch {}
}

/**
 * @param {string|null} uid — Firebase UID (없으면 localStorage만 사용)
 * @param {string} featureKey — 예: 'notifications'
 * @param {object} [profile] — AuthContext의 profile 객체 (featuresSeen 필드 참조)
 * @returns {{ seen: boolean, markSeen: () => Promise<void> }}
 */
export function useFeatureSeen(uid, featureKey, profile) {
    const [seen, setSeen] = useState(() => readLocal(featureKey));

    // Firestore profile 동기화 — 다른 기기에서 본 경우 또는 온보딩 완료 시 반영
    useEffect(() => {
        if (profile?.featuresSeen?.[featureKey] === true && !seen) {
            writeLocal(featureKey, true);
            setSeen(true);
        }
    }, [profile?.featuresSeen, featureKey, seen]);

    const markSeen = useCallback(async () => {
        if (seen) return;
        setSeen(true);
        writeLocal(featureKey, true);
        if (uid) {
            try {
                await updateDoc(doc(db, 'users', uid), {
                    [`featuresSeen.${featureKey}`]: true,
                });
            } catch (e) {
                // Firestore 실패해도 로컬은 유지 — 다음 로그인에서 재시도됨
                console.warn('[featureSeen] Firestore write failed:', e.message);
            }
        }
    }, [seen, uid, featureKey]);

    return { seen, markSeen };
}
