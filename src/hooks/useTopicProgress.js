import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  W_TARGET,
  P_TARGET,
  makeEmptyProgress,
  isTopicMastered,
} from '../config/learningPath.js';

// ── 토픽별 진행 모델 훅 ────────────────────────────────────────────────────
// 서브컬렉션 users/{uid}/topicProgress/{topicId}--{lang} 에 기록한다.
// useDailyProgress 패턴 준수: 진입 시 getDocs 1회(전체 컬렉션) + optimistic 로컬맵 +
// 백그라운드 setDoc(transaction). onSnapshot 금지, users 본문 write 금지(iOS 발열 규칙).
//
// recordPass({ topicId, lang, level, phase, itemKey }) 를 단계학습(VocabTab/ListeningTab)
// 패스(score>=goal) 지점에서 호출. itemKey 로 멀티 디바이스/세션 멱등 dedup.

const LEVELS = ['basic', 'intermediate', 'advanced'];

const normalizeByLevel = (raw) => {
  const out = {};
  LEVELS.forEach((lv) => {
    out[lv] = {
      word: raw?.[lv]?.word || 0,
      passage: raw?.[lv]?.passage || 0,
    };
  });
  return out;
};

export const useTopicProgress = (user) => {
  // { [lang]: { [topicId]: progressObject } }
  const [progressByLang, setProgressByLang] = useState({});
  const [loaded, setLoaded] = useState(false);
  const progressByLangRef = useRef({});
  // 같은 세션 내 동일 itemKey 중복 write 방지 (트랜잭션 라운드트립 전 빠른 연타 차단)
  const inflightKeysRef = useRef(new Set());

  useEffect(() => { progressByLangRef.current = progressByLang; }, [progressByLang]);

  const load = useCallback(async () => {
    const uid = user?.uid;
    if (!uid) return;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'topicProgress'));
      const byLang = {};
      snap.forEach((d) => {
        const data = d.data();
        const { lang, topicId } = data || {};
        if (!lang || !topicId) return;
        if (!byLang[lang]) byLang[lang] = {};
        byLang[lang][topicId] = data;
      });
      progressByLangRef.current = byLang;
      setProgressByLang(byLang);
      setLoaded(true);
    } catch (e) {
      console.error('[useTopicProgress] 로드 실패 (보안 규칙 확인 필요):', e);
      setLoaded(true); // 실패해도 빈 맵으로 UI 진행 (전부 locked)
    }
  }, [user?.uid]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      progressByLangRef.current = {};
      inflightKeysRef.current = new Set();
      setProgressByLang({});
      setLoaded(false);
      return;
    }
    setLoaded(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]); // uid만 의존 — 토큰 갱신 시 user 레퍼런스 변경으로 인한 재실행 방지

  // score>=goal 통과 1건 기록. phase: 'word' | 'passage'
  // 반환: true = 이번 호출로 새로 카운트됨, false = 중복/무효
  const recordPass = useCallback(async ({ topicId, lang, level = 'basic', phase, itemKey }) => {
    if (!user?.uid || !topicId || !lang) return false;
    if (phase !== 'word' && phase !== 'passage') return false;
    const lv = LEVELS.includes(level) ? level : 'basic';
    const docId = `${topicId}--${lang}`;
    const key = itemKey != null && itemKey !== ''
      ? String(itemKey)
      : `${phase}-${lv}-${Date.now()}`; // itemKey 없으면 멱등 불가 — 매번 카운트

    const inflightTag = `${docId}:${phase}:${key}`;
    if (inflightKeysRef.current.has(inflightTag)) return false;
    inflightKeysRef.current.add(inflightTag);

    const keysField = phase === 'word' ? 'wordKeys' : 'passageKeys';
    const ref = doc(db, 'users', user.uid, 'topicProgress', docId);

    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : null;
        const existingKeys = Array.isArray(data?.[keysField]) ? data[keysField] : [];
        if (existingKeys.includes(key)) return null; // 이미 다른 디바이스/세션이 카운트

        const nextKeys = [...existingKeys, key];
        const wordMastered = phase === 'word' ? nextKeys.length : (data?.wordMastered || 0);
        const passageMastered = phase === 'passage' ? nextKeys.length : (data?.passageMastered || 0);

        const byLevel = normalizeByLevel(data?.byLevel);
        byLevel[lv][phase] = (byLevel[lv][phase] || 0) + 1;

        const status = (wordMastered >= W_TARGET && passageMastered >= P_TARGET)
          ? 'mastered'
          : 'in_progress';

        const next = {
          topicId,
          lang,
          wordMastered,
          passageMastered,
          [keysField]: nextKeys,
          byLevel,
          status,
          updatedAt: serverTimestamp(),
        };
        tx.set(ref, next, { merge: true });
        // 로컬 반영용 — serverTimestamp는 로컬에선 null이라 updatedAt 제외 후 반환
        return { ...next, [keysField]: nextKeys, updatedAt: Date.now() };
      });

      if (!result) return false; // 중복

      // optimistic 로컬맵 갱신 (반대 phase keys는 기존 값 보존)
      setProgressByLang((prev) => {
        const langMap = prev[lang] || {};
        const cur = langMap[topicId] || makeEmptyProgress(topicId, lang);
        const merged = {
          ...cur,
          ...result,
          // result에는 이번 phase keys만 들어있으므로 반대 phase keys 보존
          wordKeys: phase === 'word' ? result.wordKeys : (cur.wordKeys || []),
          passageKeys: phase === 'passage' ? result.passageKeys : (cur.passageKeys || []),
        };
        return { ...prev, [lang]: { ...langMap, [topicId]: merged } };
      });
      return true;
    } catch (e) {
      console.error('[useTopicProgress] recordPass 실패:', e);
      inflightKeysRef.current.delete(inflightTag); // 재시도 가능하게 롤백
      return false;
    }
  }, [user?.uid]);

  // 특정 언어의 토픽맵 셀렉터 (LearningPathHome/TopicHub용)
  const getLangProgress = useCallback(
    (lang) => progressByLang[lang] || {},
    [progressByLang],
  );

  // 단일 토픽 진행 조회 (없으면 빈 진행)
  const getTopicProgress = useCallback(
    (topicId, lang) => progressByLang[lang]?.[topicId] || makeEmptyProgress(topicId, lang),
    [progressByLang],
  );

  return {
    loaded,
    progressByLang,
    getLangProgress,
    getTopicProgress,
    recordPass,
    reload: load,
    isTopicMastered, // 호출부 편의 재노출
  };
};
