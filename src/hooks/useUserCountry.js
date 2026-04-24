import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { resolveUserCountry } from '../config/languageFlags';

// 사용자 국가 코드 추정 (ISO 3166-1 alpha-2)
//   priority: profile.phoneCountry > navigator.language region > profile.geoCountry > null
// 언어별 국기 표시 변형(es→🇲🇽, en→🇬🇧 등)에 사용
export function useUserCountry() {
  const { profile } = useAuth();
  return useMemo(
    () => resolveUserCountry(profile),
    [profile?.phoneCountry, profile?.geoCountry]
  );
}
