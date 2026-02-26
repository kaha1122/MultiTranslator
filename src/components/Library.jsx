import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import TranslationCard from './TranslationCard';
import { Search, Trash2 } from 'lucide-react';

const Library = ({ user, sourceLang, onSpeak }) => {
    const [savedCards, setSavedCards] = useState([]);
    const [filterLang, setFilterLang] = useState('all');
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); // 에러 메시지를 표시할 상태 변수 추가

    // 1. Firebase에서 내가 저장한 카드 실시간으로 가져오기
    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, "savedCards"),
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        // onSnapshot의 3번째 인자로 에러가 발생했을 때 처리(Error Handling)를 추가합니다.
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const cards = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setSavedCards(cards);
                setIsLoading(false);
                setErrorMsg(null); // 성공적으로 가져오면 에러 메시지 초기화
            },
            (error) => {
                console.error("Error loading library:", error);
                // 가져오기에 실패하면 인터넷 문제나 권한 문제일 테니 에러를 저장해 표시합니다.
                setErrorMsg("Cannot load library data. Please check your internet connection. 😥");
                setIsLoading(false); // 무한 로딩 빙글빙글 도는 것을 막습니다.
            }
        );

        return () => unsubscribe();
    }, [user]);

    // 2. 카드 삭제 기능
    const handleDeleteCard = async (id) => {
        if (window.confirm("Delete this card from the library?")) {
            try {
                await deleteDoc(doc(db, "savedCards", id));
            } catch (error) {
                console.error("Delete failed:", error);
            }
        }
    };

    // 3. 언어별 필터링 로직
    const filteredCards = filterLang === 'all'
        ? savedCards
        : savedCards.filter(card => card.langCode === filterLang);

    // 저장된 카드들 중 존재하는 언어 목록 추출 (필터 탭용)
    const availableLangs = ['all', ...new Set(savedCards.map(c => c.langCode))];

    if (isLoading) {
        return <div className="loading-container">보관함을 여는 중... 📚</div>;
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
                    화면 새로고침
                </button>
            </div>
        );
    }

    return (
        <div className="library-container">
            {/* 언어 필터 탭 */}
            <div className="filter-tabs">
                {availableLangs.map(lang => (
                    <button
                        key={lang}
                        className={`filter-tab ${filterLang === lang ? 'active' : ''}`}
                        onClick={() => setFilterLang(lang)}
                    >
                        {lang === 'all' ? 'All' : lang.toUpperCase()}
                    </button>
                ))}
            </div>

            {/* 카드 목록 정렬 */}
            <div className="cards-grid">
                {filteredCards.length > 0 ? (
                    filteredCards.map(card => (
                        <div key={card.id} className="library-card-wrapper" style={{ position: 'relative' }}>
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
                            />
                            {/* 삭제 버튼 추가 */}
                            <button
                                className="delete-card-btn"
                                onClick={() => handleDeleteCard(card.id)}
                                title="Delete"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="empty-library">
                        <Search size={48} opacity={0.2} />
                        <p>Library is empty.<br />Swipe important cards to save them!</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Library;
