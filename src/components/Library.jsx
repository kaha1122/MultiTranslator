import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, limit, serverTimestamp } from 'firebase/firestore';
import TranslationCard from './TranslationCard';
import { Search, Trash2, Volume2, PenLine, ChevronDown, ArrowLeft } from 'lucide-react';
import { useT } from '../utils/i18n';
import './Library.css';

// ── 이번주 월요일 00:00 (현지시간) 계산 ──
function getThisWeekMonday() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // Mon=0
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}

const Library = ({ user, sourceLang, onSpeak, languageGoals = {}, todayCount = 0, dailyGoal = 10, onTargetAchieved, onCardDeleted, focusCardId, onFocusCardHandled, libraryBackTo, onBack, progressPopupOpen }) => {
    const t = useT(sourceLang);
    const [savedCards, setSavedCards] = useState([]);

    // ── 필터 상태 (localStorage 복원) ──
    const [filterLang, setFilterLang] = useState(() => localStorage.getItem('library_filterLang') || 'all');
    const [filterTypes, setFilterTypes] = useState(() => {
        const saved = localStorage.getItem('library_filterTypes');
        const parsed = saved ? JSON.parse(saved) : null;
        return (parsed && parsed.length > 0) ? new Set(parsed) : new Set(['W', 'S']);
    });
    const [filterTargetMissed, setFilterTargetMissed] = useState(() => localStorage.getItem('library_filterTargetMissed') === 'true');
    const [filterSource, setFilterSource] = useState(() => localStorage.getItem('library_filterSource') || 'all');
    const [filterDifficulty, setFilterDifficulty] = useState(() => localStorage.getItem('library_filterDifficulty') || 'all');
    const [filterStarred, setFilterStarred] = useState(() => localStorage.getItem('library_filterStarred') === 'true');
    const [filterThisWeek, setFilterThisWeek] = useState(() => {
        const saved = localStorage.getItem('library_filterThisWeek');
        return saved === null ? true : saved === 'true'; // 기본 ON
    });
    const [dateFrom, setDateFrom] = useState(() => localStorage.getItem('library_dateFrom') || '');
    const [dateTo, setDateTo] = useState(() => localStorage.getItem('library_dateTo') || '');

    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [limitCount, setLimitCount] = useState(10);
    const [hasMore, setHasMore] = useState(true);
    const observerTarget = useRef(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [sessionAudioUrls, setSessionAudioUrls] = useState({});
    const [memoOpenId, setMemoOpenId] = useState(null);

    // ── 바텀시트 상태 ──
    const [bottomSheet, setBottomSheet] = useState(null); // null | 'lang' | 'ws' | 'source' | 'difficulty'

    // ── localStorage 동기화 ──
    useEffect(() => {
        localStorage.setItem('library_filterLang', filterLang);
        localStorage.setItem('library_filterTypes', JSON.stringify(Array.from(filterTypes)));
        localStorage.setItem('library_filterTargetMissed', filterTargetMissed.toString());
        localStorage.setItem('library_filterSource', filterSource);
        localStorage.setItem('library_filterDifficulty', filterDifficulty);
        localStorage.setItem('library_filterStarred', filterStarred.toString());
        localStorage.setItem('library_filterThisWeek', filterThisWeek.toString());
        localStorage.setItem('library_dateFrom', dateFrom);
        localStorage.setItem('library_dateTo', dateTo);
    }, [filterLang, filterTypes, filterTargetMissed, filterSource, filterDifficulty, filterStarred, filterThisWeek, dateFrom, dateTo]);

    // ── Firebase 실시간 구독 ──
    useEffect(() => {
        if (!user) return;
        let q;
        if (searchTerm.trim() !== '') {
            q = query(collection(db, "savedCards"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
        } else {
            q = query(collection(db, "savedCards"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(limitCount));
        }
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(card => !card.isDeleted);
            setSavedCards(cards);
            if (!searchTerm && cards.length < limitCount) setHasMore(false); else setHasMore(true);
            setIsLoading(false);
            setErrorMsg(null);
        }, (error) => {
            console.error("Error loading library:", error);
            setErrorMsg(t('library.loadError'));
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [user, limitCount, searchTerm]);

    // ── 무한 스크롤 ──
    useEffect(() => {
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore && !searchTerm) setLimitCount(prev => prev + 10);
        }, { threshold: 1.0 });
        if (observerTarget.current) observer.observe(observerTarget.current);
        return () => { if (observerTarget.current) observer.unobserve(observerTarget.current); };
    }, [hasMore, searchTerm]);

    // ── Vocab에서 넘어온 카드 포커스: 필터 초기화 + 스크롤 ──
    const focusCardPending = useRef(null);
    useEffect(() => {
        if (!focusCardId) return;
        // 필터를 초기화하여 방금 생성된 카드가 반드시 보이도록
        focusCardPending.current = focusCardId;
        setFilterSource('all');
        setFilterDifficulty('all');
        setFilterLang('all');
        setFilterStarred(false);
        setFilterTargetMissed(false);
        setSearchTerm('');
    }, [focusCardId]);

    useEffect(() => {
        if (!focusCardPending.current || savedCards.length === 0) return;
        if (progressPopupOpen) return; // 팝업이 열려 있으면 스크롤 대기
        const el = document.getElementById(`library-card-${focusCardPending.current}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.add('library-card-highlight');
            setTimeout(() => el.classList.remove('library-card-highlight'), 2000);
            focusCardPending.current = null;
            if (onFocusCardHandled) onFocusCardHandled();
        }
    }, [savedCards, progressPopupOpen]);

    // (Back키는 App.jsx에서 전역 관리 — header Back 버튼으로 복귀)

    // ── 카드 삭제 ──
    const triggerDelete = (id) => setDeleteConfirmId(id);
    const confirmDelete = async () => {
        if (!deleteConfirmId) return;
        const card = savedCards.find(c => c.id === deleteConfirmId);
        try {
            await updateDoc(doc(db, "savedCards", deleteConfirmId), { isDeleted: true, deletedAt: serverTimestamp() });
            onCardDeleted?.(card?.langCode, card?.sourceText);
            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Delete failed:", error);
            setDeleteConfirmId(null);
        }
    };
    const cancelDelete = () => setDeleteConfirmId(null);

    // ── 중요 마크 토글 ──
    const toggleStarred = async (cardId, currentVal) => {
        const newVal = !currentVal;
        setSavedCards(prev => prev.map(c => c.id === cardId ? { ...c, starred: newVal } : c));
        try {
            await updateDoc(doc(db, "savedCards", cardId), { starred: newVal });
        } catch (e) {
            console.error("Star toggle failed:", e);
            setSavedCards(prev => prev.map(c => c.id === cardId ? { ...c, starred: currentVal } : c));
        }
    };

    const handleMemoUpdate = (cardId, newMemos, newAnnotations, newUserNotes) => {
        setSavedCards(prev => prev.map(card => card.id === cardId ? { ...card, memos: newMemos, annotations: newAnnotations, userNotes: newUserNotes ?? card.userNotes } : card));
    };

    const handlePracticeResult = async (id, langCode, result) => {
        if (result.audioUrl) setSessionAudioUrls(prev => ({ ...prev, [id]: result.audioUrl }));
        if (result.pronunciationScore != null) {
            setSavedCards(prev => prev.map(card => card.id === id ? { ...card, pronunciationScore: result.pronunciationScore } : card));
            const targetGoal = languageGoals[langCode] || 80;
            if (result.pronunciationScore >= targetGoal) onTargetAchieved?.(`library-${id}`);
            try {
                await updateDoc(doc(db, "savedCards", id), { pronunciationScore: result.pronunciationScore });
            } catch (error) {
                console.error("Failed to update pronunciation score:", error);
            }
        }
    };

    const playPronunciationAudio = (url) => {
        if (!url) return;
        new Audio(url).play().catch(e => console.error("Audio play failed:", e));
    };

    // ── 필터링 로직 ──
    let filteredCards = savedCards;

    if (filterLang !== 'all') filteredCards = filteredCards.filter(card => card.langCode === filterLang);

    if (filterTypes.size === 1) filteredCards = filteredCards.filter(card => filterTypes.has(card.inputType || 'S'));

    if (filterSource !== 'all') {
        filteredCards = filteredCards.filter(card => {
            const src = card.sourceType || 'translation';
            return src === filterSource;
        });
    }

    if (filterDifficulty !== 'all') {
        filteredCards = filteredCards.filter(card => (card.difficulty || 'basic') === filterDifficulty);
    }

    if (searchTerm.trim() !== '') {
        const lowerSearch = searchTerm.toLowerCase();
        filteredCards = filteredCards.filter(card => {
            return card.sourceText?.toLowerCase().includes(lowerSearch) ||
                   card.translatedText?.toLowerCase().includes(lowerSearch) ||
                   card.pronunciation?.toLowerCase().includes(lowerSearch);
        });
    }

    if (filterTargetMissed) {
        filteredCards = filteredCards.filter(card => {
            const targetGoal = languageGoals[card.langCode] || 80;
            return !card.pronunciationScore || card.pronunciationScore < targetGoal;
        });
    }

    if (filterStarred) filteredCards = filteredCards.filter(card => card.starred);

    if (filterThisWeek) {
        const monday = getThisWeekMonday();
        filteredCards = filteredCards.filter(card => {
            if (!card.createdAt) return false;
            const cardDate = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
            return cardDate >= monday;
        });
    }

    if (dateFrom || dateTo) {
        filteredCards = filteredCards.filter(card => {
            if (!card.createdAt) return false;
            const cardDate = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
            if (dateFrom && cardDate < new Date(dateFrom)) return false;
            if (dateTo) {
                const toEnd = new Date(dateTo);
                toEnd.setHours(23, 59, 59, 999);
                if (cardDate > toEnd) return false;
            }
            return true;
        });
    }

    // 언어 목록 추출
    const availableLangs = ['all', ...new Set(savedCards.map(c => c.langCode))];

    // 소스 목록
    const SOURCE_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'scene', label: t('library.srcScene') },
        { value: 'vocab', label: t('library.srcVocab') },
        { value: 'translation', label: t('library.srcTranslation') },
    ];

    // 난이도 목록
    const DIFF_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'basic', label: t('scene.diffBasic') },
        { value: 'intermediate', label: t('scene.diffIntermediate') },
        { value: 'high', label: t('scene.diffHigh') },
    ];

    // W/S 옵션
    const WS_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'W', label: t('library.typeWord') },
        { value: 'S', label: t('library.typeSentence') },
    ];

    // 현재 선택된 드롭다운 라벨
    const getLangLabel = () => filterLang === 'all' ? t('library.filterAll') : filterLang.toUpperCase();
    const getWsLabel = () => {
        if (filterTypes.size === 2 || filterTypes.size === 0) return t('library.filterAll');
        if (filterTypes.has('W')) return t('library.typeWord');
        return t('library.typeSentence');
    };
    const getSourceLabel = () => SOURCE_OPTIONS.find(o => o.value === filterSource)?.label || t('library.filterAll');
    const getDiffLabel = () => DIFF_OPTIONS.find(o => o.value === filterDifficulty)?.label || t('library.filterAll');

    if (isLoading) return <div className="loading-container">{t('library.loading')}</div>;

    if (errorMsg) {
        return (
            <div className="error-container" style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
                <p>⚠️ {errorMsg}</p>
                <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                    {t('library.refresh')}
                </button>
            </div>
        );
    }

    return (
        <div className="library-container library-theme">
            {/* Back 버튼은 App 헤더 우측 상단으로 이동 */}
            {/* ── 필터 박스 ── */}
            <div className="lib-filter-box">
                {/* 1) 검색바 */}
                <div className="lib-search-wrap">
                    <Search size={16} className="lib-search-icon" />
                    <input
                        type="text"
                        className="lib-search-input"
                        placeholder={t('library.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Row 1: 드롭다운들 */}
                <div className="lib-filter-row">
                    {/* 2) 언어 */}
                    <button
                        className={`lib-dropdown-btn ${filterLang !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('lang')}
                    >
                        {t('library.filterLang')} : {getLangLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 3) W/S */}
                    <button
                        className={`lib-dropdown-btn ${(filterTypes.size === 1) ? 'active' : ''}`}
                        onClick={() => setBottomSheet('ws')}
                    >
                        W/S : {getWsLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 5) 소스 */}
                    <button
                        className={`lib-dropdown-btn ${filterSource !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('source')}
                    >
                        {t('library.filterSource')} : {getSourceLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 6) 난이도 */}
                    <button
                        className={`lib-dropdown-btn ${filterDifficulty !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('difficulty')}
                    >
                        {t('library.filterDiff')} : {getDiffLabel()} <ChevronDown size={12} className="chevron" />
                    </button>
                </div>

                {/* Row 2: 토글 칩들 + 카드 수 */}
                <div className="lib-filter-row">
                    {/* 4) 목표 미달 */}
                    <button
                        className={`lib-toggle-chip target-miss ${filterTargetMissed ? 'on' : ''}`}
                        onClick={() => setFilterTargetMissed(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterTargetMiss')}
                    </button>

                    {/* 6) 중요 */}
                    <button
                        className={`lib-toggle-chip ${filterStarred ? 'on' : ''}`}
                        onClick={() => setFilterStarred(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterStarred')}
                    </button>

                    {/* 7) 이번주 */}
                    <button
                        className={`lib-toggle-chip this-week ${filterThisWeek ? 'on' : ''}`}
                        onClick={() => setFilterThisWeek(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterThisWeek')}
                    </button>

                    {/* 8) 필터링 카드 수 / 전체 카드 수 */}
                    <span className="lib-card-count">
                        {filteredCards.length}/{savedCards.length}
                    </span>
                </div>

                {/* Row 3: 기간 (이번주 OFF일 때만 표시) */}
                {!filterThisWeek && (
                    <div className="lib-date-row">
                        <input type="date" className="lib-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        <span className="lib-date-sep">~</span>
                        <input type="date" className="lib-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                        {(dateFrom || dateTo) && (
                            <button className="lib-date-clear" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                                {t('library.dateClear')}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── 카드 목록 ── */}
            <div className="cards-grid">
                {filteredCards.length > 0 ? (
                    filteredCards.map((card, idx) => {
                        // 카드 번호: 전체 savedCards에서의 순서 (오래된 카드부터 1번)
                        const globalIndex = savedCards.indexOf(card);
                        const cardNumber = globalIndex >= 0 ? savedCards.length - globalIndex : filteredCards.length - idx;
                        return (
                        <div key={card.id} id={`library-card-${card.id}`} className="library-card-wrapper">
                            <TranslationCard
                                language={card.language}
                                langCode={card.langCode}
                                cardNumber={cardNumber}
                                sourceLangCode={card.sourceLang || 'ko'}
                                text={card.translatedText}
                                pronunciation={card.pronunciation}
                                learningTip={card.learningTip}
                                badgeColor={card.langCode === 'en' ? '#e0e7ff' : card.langCode === 'ja' ? '#fef2f2' : '#fff7ed'}
                                badgeTextColor={card.langCode === 'en' ? '#4338ca' : card.langCode === 'ja' ? '#b91c1c' : '#9a3412'}
                                onSpeak={() => onSpeak(card.translatedText, card.langCode, card.selectedEmotion)}
                                isInSelectionMode={false}
                                isLibraryView={true}
                                onPracticeResult={(langCode, result) => handlePracticeResult(card.id, langCode, result)}
                                onTargetAchieved={onTargetAchieved}
                                targetGoal={languageGoals[card.langCode] || 80}
                                cardId={card.id}
                                memos={card.memos || []}
                                annotations={card.annotations || []}
                                userNotes={card.userNotes || []}
                                onMemoUpdate={(newMemos, newAnnotations, newUserNotes) => handleMemoUpdate(card.id, newMemos, newAnnotations, newUserNotes)}
                                starred={card.starred || false}
                                onToggleStarred={() => toggleStarred(card.id, card.starred)}
                                memoPopupOpen={memoOpenId === card.id}
                                onMemoClose={() => setMemoOpenId(null)}
                                selectedEmotion={card.selectedEmotion || ''}
                                interactionType={card.interactionType || ''}
                            />

                            {/* 하단 액션바 */}
                            <div className="card-action-bar">
                                <div className="action-left" style={{ display: 'flex', alignItems: 'center' }}>
                                    <span className="stat-text" title="목표 점수">🎯 <strong>{languageGoals[card.langCode] || 80}</strong></span>
                                    <span className="stat-divider">·</span>
                                    <span className="stat-text" title="내 점수">⭐️ <strong>{card.pronunciationScore || '-'}</strong></span>
                                    <span className="stat-divider">·</span>
                                    <span className="stat-text" title="달성 여부">
                                        {card.pronunciationScore && card.pronunciationScore >= (languageGoals[card.langCode] || 80) ? '✅' : '❌'}
                                    </span>
                                    <span className="stat-divider">·</span>
                                    <button
                                        className="stat-icon-btn"
                                        title={sessionAudioUrls[card.id] ? "내 발음 다시 듣기" : "녹음 후 활성화됩니다"}
                                        onClick={(e) => { e.stopPropagation(); playPronunciationAudio(sessionAudioUrls[card.id]); }}
                                        disabled={!sessionAudioUrls[card.id]}
                                        style={{ background: 'none', border: 'none', outline: 'none', cursor: sessionAudioUrls[card.id] ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', opacity: sessionAudioUrls[card.id] ? 1 : 0.3, color: 'var(--text-secondary)' }}
                                    >
                                        <Volume2 size={16} />
                                    </button>
                                    <span className="stat-divider">·</span>
                                    <button
                                        className="stat-icon-btn"
                                        title="메모 / 어노테이션"
                                        onClick={(e) => { e.stopPropagation(); setMemoOpenId(memoOpenId === card.id ? null : card.id); }}
                                        style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: (card.memos?.length || card.userNotes?.length) ? '#6366f1' : 'var(--text-secondary)' }}
                                    >
                                        <PenLine size={16} />
                                    </button>
                                </div>
                                <div className="action-right">
                                    <button
                                        className="action-icon-btn delete-action"
                                        onClick={(e) => { e.stopPropagation(); triggerDelete(card.id); }}
                                        title="Delete from Library"
                                    >
                                        <Trash2 size={22} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )})
                ) : (
                    <div className="empty-library">
                        <Search size={48} opacity={0.2} />
                        <p>{t('library.empty').split('\n').map((line, i) => i === 0 ? line : <><br key={i} />{line}</>)}</p>
                    </div>
                )}
            </div>

            {/* 무한 스크롤 */}
            {!searchTerm && hasMore && filteredCards.length > 0 && (
                <div ref={observerTarget} style={{ height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{t('library.loadingMore')}</span>
                </div>
            )}
            {!hasMore && filteredCards.length > 0 && !searchTerm && (
                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '1rem', fontSize: '0.875rem', paddingBottom: '1rem' }}>
                    {t('library.reachedEnd')}
                </div>
            )}

            {/* ── 바텀시트: 언어 선택 ── */}
            {bottomSheet === 'lang' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterLang')}</div>
                        {availableLangs.map(lang => (
                            <button key={lang} className={`lib-bs-option ${filterLang === lang ? 'selected' : ''}`}
                                onClick={() => { setFilterLang(lang); setBottomSheet(null); }}>
                                <span>{lang === 'all' ? t('library.filterAll') : lang.toUpperCase()}</span>
                                {filterLang === lang && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: W/S 선택 ── */}
            {bottomSheet === 'ws' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">W / S</div>
                        {WS_OPTIONS.map(opt => {
                            const isSelected = opt.value === 'all'
                                ? (filterTypes.size === 2 || filterTypes.size === 0)
                                : (filterTypes.size === 1 && filterTypes.has(opt.value));
                            return (
                                <button key={opt.value} className={`lib-bs-option ${isSelected ? 'selected' : ''}`}
                                    onClick={() => {
                                        if (opt.value === 'all') setFilterTypes(new Set(['W', 'S']));
                                        else setFilterTypes(new Set([opt.value]));
                                        setBottomSheet(null);
                                    }}>
                                    <span>{opt.label}</span>
                                    {isSelected && <span className="bs-check">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: 소스 선택 ── */}
            {bottomSheet === 'source' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterSource')}</div>
                        {SOURCE_OPTIONS.map(opt => (
                            <button key={opt.value} className={`lib-bs-option ${filterSource === opt.value ? 'selected' : ''}`}
                                onClick={() => { setFilterSource(opt.value); setBottomSheet(null); }}>
                                <span>{opt.label}</span>
                                {filterSource === opt.value && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: 난이도 선택 ── */}
            {bottomSheet === 'difficulty' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterDiff')}</div>
                        {DIFF_OPTIONS.map(opt => (
                            <button key={opt.value} className={`lib-bs-option ${filterDifficulty === opt.value ? 'selected' : ''}`}
                                onClick={() => { setFilterDifficulty(opt.value); setBottomSheet(null); }}>
                                <span>{opt.label}</span>
                                {filterDifficulty === opt.value && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 삭제 확인 모달 */}
            {deleteConfirmId && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', padding: '24px', borderRadius: '16px', maxWidth: '320px', width: '90%', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                        <p style={{ margin: '0 0 24px 0', fontSize: '1.05rem', color: '#1f2937', fontWeight: '600', lineHeight: '1.5' }}>
                            {t('library.deleteConfirm')}
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button onClick={cancelDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: '1px solid #e5e7eb', backgroundColor: 'white', color: '#4b5563', fontWeight: 'bold', cursor: 'pointer' }}>
                                {t('library.deleteCancel')}
                            </button>
                            <button onClick={confirmDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: 'none', backgroundColor: '#ef4444', color: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(239,68,68,0.3)' }}>
                                {t('library.deleteOk')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Library;
