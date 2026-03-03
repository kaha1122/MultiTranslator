import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc, updateDoc, limit } from 'firebase/firestore';
import TranslationCard from './TranslationCard';
import { Search, Trash2, Volume2 } from 'lucide-react';
import { useT } from '../utils/i18n';

const Library = ({ user, sourceLang, onSpeak, languageGoals = {} }) => {
    const t = useT(sourceLang);
    const [savedCards, setSavedCards] = useState([]);
    // 상태 초기값을 브라우저 저장소(localStorage)에서 먼저 찾아보고 없으면 기본값을 씁니다.
    const [filterLang, setFilterLang] = useState(() => {
        return localStorage.getItem('library_filterLang') || 'all';
    });
    // [신규] 'W' (단어), 'S' (문장) 다중 선택 필터 상태 (배열을 Set으로 변환)
    const [filterTypes, setFilterTypes] = useState(() => {
        const saved = localStorage.getItem('library_filterTypes');
        return saved ? new Set(JSON.parse(saved)) : new Set(['W', 'S']);
    });
    // [신규] 목표 점수 미달 카드만 보기 필터 상태
    const [filterTargetMissed, setFilterTargetMissed] = useState(() => {
        return localStorage.getItem('library_filterTargetMissed') === 'true';
    });
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null);

    // [신규] 필터 상태가 바뀔 때마다 브라우저 로컬 스토리지에 자동 저장하여 다음 접속 시 기억하게 합니다.
    useEffect(() => {
        localStorage.setItem('library_filterLang', filterLang);
        localStorage.setItem('library_filterTypes', JSON.stringify(Array.from(filterTypes)));
        localStorage.setItem('library_filterTargetMissed', filterTargetMissed.toString());
    }, [filterLang, filterTypes, filterTargetMissed]);

    // 무한 스크롤 및 검색 관련 상태 변수
    const [limitCount, setLimitCount] = useState(10);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasMore, setHasMore] = useState(true);
    const observerTarget = useRef(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null); // [신규] 커스텀 삭제 모달을 위한 ID 상태
    const [sessionAudioUrls, setSessionAudioUrls] = useState({}); // 세션 내 녹음 Blob URL 맵 { cardId → url }

    // 1. Firebase에서 내가 저장한 카드 실시간으로 가져오기 (무한 스크롤 & 검색 대응)
    useEffect(() => {
        if (!user) return;

        let q;
        // 검색어가 있을 때는 전체 목록을 가져와 클라이언트 필터링(Like 검색)을 지원하여 한계를 극복합니다.
        if (searchTerm.trim() !== '') {
            q = query(
                collection(db, "savedCards"),
                where("userId", "==", user.uid),
                orderBy("createdAt", "desc")
            );
        } else {
            // 평소에는 지정된 개수(limitCount)만큼만 가져옵니다.
            q = query(
                collection(db, "savedCards"),
                where("userId", "==", user.uid),
                orderBy("createdAt", "desc"),
                limit(limitCount)
            );
        }

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const cards = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setSavedCards(cards);

                // 만약 가져온 개수가 현재 제한값보다 적다면 더 이상 데이터가 없다는 뜻입니다.
                if (!searchTerm && cards.length < limitCount) {
                    setHasMore(false);
                } else {
                    setHasMore(true);
                }

                setIsLoading(false);
                setErrorMsg(null);
            },
            (error) => {
                console.error("Error loading library:", error);
                setErrorMsg(t('library.loadError'));
                setIsLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user, limitCount, searchTerm]);

    // [신규] 무한 스크롤 스크롤 감지 (Intersection Observer)
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                // 맨 아래 요소가 보이고, 더 불러올 데이터가 있고, 검색중이 아닐 때만 10장 추가!
                if (entries[0].isIntersecting && hasMore && !searchTerm) {
                    setLimitCount(prev => prev + 10);
                }
            },
            { threshold: 1.0 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => {
            if (observerTarget.current) observer.unobserve(observerTarget.current);
        };
    }, [hasMore, searchTerm]);

    // 2. 카드 삭제 기능 (커스텀 팝업으로 변경)
    const triggerDelete = (id) => {
        setDeleteConfirmId(id);
    };

    const confirmDelete = async () => {
        if (!deleteConfirmId) return;
        try {
            await deleteDoc(doc(db, "savedCards", deleteConfirmId));
            setDeleteConfirmId(null); // 모달 닫기
        } catch (error) {
            console.error("Delete failed:", error);
            alert(`카드 삭제에 실패했습니다! 😥\n\n에러 메시지: ${error.message}`);
            setDeleteConfirmId(null);
        }
    };

    const cancelDelete = () => {
        setDeleteConfirmId(null);
    };

    // [신규] 2-1. 보관함 카드 재연습 시 점수 업데이트 + 세션 오디오 URL 저장
    const handlePracticeResult = async (id, _langCode, result) => {
        try {
            // 방금 녹음한 Blob URL을 세션 상태에 저장 (새로고침 전까지 재생 가능)
            if (result.audioUrl) {
                setSessionAudioUrls(prev => ({ ...prev, [id]: result.audioUrl }));
            }
            if (result.pronunciationScore !== undefined) {
                setSavedCards(currentCards =>
                    currentCards.map(card =>
                        card.id === id ? { ...card, pronunciationScore: result.pronunciationScore } : card
                    )
                );
                const cardRef = doc(db, "savedCards", id);
                await updateDoc(cardRef, { pronunciationScore: result.pronunciationScore });
            }
        } catch (error) {
            console.error("Failed to update pronunciation test results:", error);
        }
    };

    const playPronunciationAudio = (url) => {
        if (!url) return;
        new Audio(url).play().catch(e => console.error("Audio play failed:", e));
    };

    // 3. 언어 및 검색어(Like) 필터링 로직
    let filteredCards = savedCards;

    if (filterLang !== 'all') {
        filteredCards = filteredCards.filter(card => card.langCode === filterLang);
    }

    // [신규] 단어(W) / 문장(S) 타입 다중 필터 적용
    if (filterTypes.size === 0) {
        // 둘 다 체크 해제된 상태라면 목록은 비워야 합니다.
        filteredCards = [];
    } else if (filterTypes.size === 1) {
        // 둘 중 하나만 체크되었다면 해당 타입만 보여줍니다. (과거 버전의 데이터는 기본적으로 'S'로 취급)
        filteredCards = filteredCards.filter(card => filterTypes.has(card.inputType || 'S'));
    }

    if (searchTerm.trim() !== '') {
        const lowerSearch = searchTerm.toLowerCase();
        filteredCards = filteredCards.filter(card => {
            // 단어나 알파벳이 문장, 번역, 발음에 포함되어 있는지(Like) 검사
            const matchSource = card.sourceText?.toLowerCase().includes(lowerSearch);
            const matchTrans = card.translatedText?.toLowerCase().includes(lowerSearch);
            const matchPronun = card.pronunciation?.toLowerCase().includes(lowerSearch);
            return matchSource || matchTrans || matchPronun;
        });
    }

    // [신규] 목표 점수 미달 필터 적용 (체크된 경우)
    if (filterTargetMissed) {
        filteredCards = filteredCards.filter(card => {
            const targetGoal = languageGoals[card.langCode] || 80; // 기본 목표는 80점
            // 평가 점수가 아예 없거나(한 번도 안 함), 목표 점수 미만인 경우만 남김
            return !card.pronunciationScore || card.pronunciationScore < targetGoal;
        });
    }

    // 저장된 카드들 중 존재하는 언어 목록 추출 (필터 탭용)
    const availableLangs = ['all', ...new Set(savedCards.map(c => c.langCode))];

    if (isLoading) {
        return <div className="loading-container">{t('library.loading')}</div>;
    }

    // 통신 오류 발생 시 나타날 부드러운 에러 화면 UI를 추가합니다.
    if (errorMsg) {
        return (
            <div className="error-container" style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
                <p>⚠️ {errorMsg}</p>
                <button
                    onClick={() => window.location.reload()}
                    style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                >
                    {t('library.refresh')}
                </button>
            </div>
        );
    }

    return (
        <div className="library-container library-theme">
            {/* [신규] 와일드카드(Like) 검색창 */}
            <div className="search-bar-container" style={{ marginBottom: '1rem', position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                    type="text"
                    placeholder=""
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: '100%', padding: '12px 12px 12px 38px', borderRadius: '12px', border: '1px solid #e5e7eb', fontSize: '1rem', outline: 'none' }}
                />
            </div>

            {/* [신규] 사진처럼 필터들을 하나의 예쁜 뒷배경 박스로 묶어줍니다 */}
            <div className="filters-container" style={{
                background: '#ffffff', // 사용자가 요청한 하얀색 바탕
                borderRadius: '16px',
                padding: '12px 16px', // 상하 여백을 16px에서 12px로 줄임
                marginBottom: '1rem', // 모든 여백을 1rem으로 통일
                border: '1px solid rgba(0, 0, 0, 0.05)', // 테두리를 아주 연하게 변경
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px' // 1층과 2층 사이의 간격을 타이트하게(12px) 고정합니다.
            }}>
                {/* 1층: 언어 필터 탭 */}
                <div className="filter-tabs" style={{ margin: 0, padding: 0 }}>
                    {availableLangs.map(lang => (
                        <button
                            key={lang}
                            className={`filter-tab ${filterLang === lang ? 'active' : ''}`}
                            onClick={() => setFilterLang(lang)}
                            style={{ margin: 0 }} // 외부 마진 제거
                        >
                            {lang === 'all' ? 'All' : lang.toUpperCase()}
                        </button>
                    ))}
                </div>

                {/* 2층: 단어/문장 필터 버튼 그룹 + 목표 미달 체크박스 */}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div className="type-filter-group" style={{ display: 'flex', gap: '8px', margin: 0, padding: 0 }}>
                        <button
                            className={`filter-tab ${filterTypes.has('W') ? 'active' : ''}`}
                            onClick={() => {
                                const newSet = new Set(filterTypes);
                                if (newSet.has('W')) newSet.delete('W');
                                else newSet.add('W');
                                setFilterTypes(newSet);
                            }}
                            style={{ background: filterTypes.has('W') ? '#10b981' : 'white', borderColor: filterTypes.has('W') ? '#10b981' : '#f1f5f9', color: filterTypes.has('W') ? 'white' : '#64748b' }}
                        >
                            # Word
                        </button>
                        <button
                            className={`filter-tab ${filterTypes.has('S') ? 'active' : ''}`}
                            onClick={() => {
                                const newSet = new Set(filterTypes);
                                if (newSet.has('S')) newSet.delete('S');
                                else newSet.add('S');
                                setFilterTypes(newSet);
                            }}
                            style={{ background: filterTypes.has('S') ? '#3b82f6' : 'white', borderColor: filterTypes.has('S') ? '#3b82f6' : '#f1f5f9', color: filterTypes.has('S') ? 'white' : '#64748b' }}
                        >
                            # Sentence
                        </button>
                    </div>

                    {/* [신규] 목표 미달(과락) 카드 필터 UI */}
                    <label style={{
                        marginLeft: 'auto', // 우측 끝으로 자연스럽게 밀어냅니다.
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        color: filterTargetMissed ? '#ef4444' : '#64748b',
                        padding: '6px 12px',
                        backgroundColor: filterTargetMissed ? '#fef2f2' : 'white',
                        border: `1px solid ${filterTargetMissed ? '#fca5a5' : '#e2e8f0'}`,
                        borderRadius: '20px',
                        transition: 'all 0.2s',
                        userSelect: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}>
                        <input
                            type="checkbox"
                            checked={filterTargetMissed}
                            onChange={(e) => setFilterTargetMissed(e.target.checked)}
                            style={{ cursor: 'pointer', accentColor: '#ef4444', width: '16px', height: '16px' }}
                        />
                        <span style={{ color: filterTargetMissed ? '#ef4444' : '#fca5a5', fontWeight: '900', fontSize: '1.1rem', lineHeight: '1' }}>X</span>
                    </label>
                </div>
            </div>

            {/* 카드 목록 정렬 */}
            <div className="cards-grid">
                {filteredCards.length > 0 ? (
                    filteredCards.map(card => (
                        <div key={card.id} className="library-card-wrapper">
                            <TranslationCard
                                language={card.language}
                                langCode={card.langCode}
                                sourceLangCode={card.sourceLang || sourceLang}
                                text={card.translatedText}
                                pronunciation={card.pronunciation}
                                learningTip={card.learningTip}
                                badgeColor={card.langCode === 'en' ? '#e0e7ff' : card.langCode === 'ja' ? '#fef2f2' : '#fff7ed'}
                                badgeTextColor={card.langCode === 'en' ? '#4338ca' : card.langCode === 'ja' ? '#b91c1c' : '#9a3412'}
                                onSpeak={() => onSpeak(card.translatedText, card.langCode)}
                                isInSelectionMode={false} // 보관함에선 선택 모드 비활성
                                isLibraryView={true} // [신규] 제스처 완전 차단
                                onPracticeResult={(langCode, result) => handlePracticeResult(card.id, langCode, result)} // [신규] 연습 시 업데이트
                                targetGoal={languageGoals[card.langCode] || 80} // [신규] 목표 점수 전달
                            />

                            {/* [신규] 아이콘화된 하단 액션바 */}
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
                                </div>
                                <div className="action-right">
                                    <button
                                        className="action-icon-btn delete-action"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            triggerDelete(card.id);
                                        }}
                                        title="Delete from Library"
                                    >
                                        <Trash2 size={22} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="empty-library">
                        <Search size={48} opacity={0.2} />
                        <p>{t('library.empty').split('\n').map((line, i) => i === 0 ? line : <><br key={i} />{line}</>)}</p>
                    </div>
                )}
            </div>

            {/* [신규] 무한 스크롤 관찰용 빈 타겟 (화면 끝에 닿으면 감지됨) */}
            {!searchTerm && hasMore && filteredCards.length > 0 && (
                <div ref={observerTarget} style={{ height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{t('library.loadingMore')}</span>
                </div>
            )}

            {/* 데이터 끝에 도달했을 때 안내 */}
            {!hasMore && filteredCards.length > 0 && !searchTerm && (
                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '1rem', fontSize: '0.875rem', paddingBottom: '1rem' }}>
                    {t('library.reachedEnd')}
                </div>
            )}

            {/* [신규] 세련된 영어 커스텀 삭제 확인 모달 */}
            {deleteConfirmId && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', padding: '24px', borderRadius: '16px', maxWidth: '320px', width: '90%', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                        <p style={{ margin: '0 0 24px 0', fontSize: '1.05rem', color: '#1f2937', fontWeight: '600', lineHeight: '1.5' }}>
                            {t('library.deleteConfirm')}
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button onClick={cancelDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: '1px solid #e5e7eb', backgroundColor: 'white', color: '#4b5563', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s' }}>
                                {t('library.deleteCancel')}
                            </button>
                            <button onClick={confirmDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: 'none', backgroundColor: '#ef4444', color: 'white', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s', boxShadow: '0 2px 4px rgba(239,68,68,0.3)' }}>
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
