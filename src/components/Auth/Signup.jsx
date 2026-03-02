import React, { useState } from 'react';
import { auth, db, googleProvider } from '../../firebase/config';
import { createUserWithEmailAndPassword, signInWithPopup, getAdditionalUserInfo } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserPlus, Mail, Lock, AlertCircle, User, Phone, MapPin, Smartphone } from 'lucide-react';
import './Auth.css';

// ─────────────────────────────────────────────────────────────
// [업그레이드된] 인앱 브라우저 감지 함수
//
// 왜 업그레이드가 필요했나?
// 이전 버전은 앱 이름(KAKAOTALK, Instagram 등)만 확인했는데,
// 카카오톡 등은 내부적으로 Android/iOS의 "WebView"를 사용하며
// 앱 이름이 User-Agent에 없는 경우도 있습니다.
// Google은 앱 이름이 아니라 "WebView 환경 자체"를 감지해서 로그인을 막습니다(403 오류).
// 따라서 앱 이름 + WebView 여부를 함께 체크해야 정확합니다.
// ─────────────────────────────────────────────────────────────
const detectInAppBrowser = () => {
    const ua = navigator.userAgent || '';

    // ① 앱 이름 직접 감지
    //    카카오톡, 인스타, 네이버, 라인, 페이스북 앱 등
    const isKnownApp = /KAKAOTALK|KAKAO|Instagram|NAVER|NaverApp|Line\/|FBAN|FBAV|Twitter|Snapchat/i.test(ua);

    // ② Android WebView 감지
    //    Android + Chrome 조합이지만 "; wv)" 패턴이 있으면 WebView(앱 내 브라우저)임을 의미
    //    예: "... Chrome/91.0.4472.120 Mobile Safari/537.36" → 일반 크롬
    //    예: "... Chrome/91.0.4472.120 Mobile Safari/537.36 KAKAOTALK/9.5.5" → 카카오 WebView
    //    예: "... wv) AppleWebKit..." → 정체불명 WebView
    const isAndroidWebView = /Android/.test(ua) && /wv\)/.test(ua);

    // ③ iOS WebView 감지
    //    iPhone/iPad이지만 'Safari'가 없으면 앱 내 WebView
    //    (Safari 앱은 반드시 'Safari' 문자열을 포함함)
    const isIOSWebView = /iPhone|iPad/.test(ua) && !/Safari/.test(ua);

    // 셋 중 하나라도 해당되면 인앱 브라우저로 판단
    return isKnownApp || isAndroidWebView || isIOSWebView;
};

function Signup({ onSwitchToLogin }) {
    const [email, setEmail] = useState('');
    const [nickname, setNickname] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSignup = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            return setError('Passwords do not match.');
        }

        setIsLoading(true);
        setError('');

        try {
            // 1. Create User in Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Save Additional Profile in Firestore
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: email,
                displayName: nickname,
                phoneNumber: phone || '',
                address: address || '',
                membership: 'Free',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

        } catch (err) {
            console.error(err);
            if (err.code === 'auth/email-already-in-use') {
                setError('This email is already in use.');
            } else {
                setError(`Failed to create an account: ${err.code} `);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError('');

        // ── 인앱 브라우저 차단 ──────────────────────────────────────
        // 카카오톡, 인스타그램 등의 내장 브라우저에서는
        // Google이 보안 정책으로 로그인을 완전히 차단합니다(403 오류).
        // 따라서 로그인 시도 전에 먼저 감지하고, 안내 메시지를 보여줍니다.
        if (detectInAppBrowser()) {
            setError('inapp'); // 특별한 에러 코드로 인앱 브라우저 상태를 구분
            setIsLoading(false);
            return; // 로그인 시도 자체를 중단
        }
        // ────────────────────────────────────────────────────────────

        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);

            // 구글 가입 기본 정보 세팅
            const profileData = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || 'Google User',
                membership: 'Free',
                updatedAt: serverTimestamp()
            };

            // [핵심] 만약 Firebase의 Auth에서 '완전 처음 가입(isNewUser)'으로 인식했다면,
            // 과거에 찌꺼기 데이터가 남아 있어도, 온보딩(팝업)을 다시 보게끼 강제로 리셋해 줍니다.
            if (additionalInfo && additionalInfo.isNewUser) {
                profileData.hasCompletedOnboarding = false;
                profileData.createdAt = serverTimestamp();
            }

            // DB에 정보 업데이트 (존재하면 덮어쓰고, 없으면 새로 생성)
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });

        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`Google login failed: ${err.code} `);
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-icon-circle signup-icon">
                        <UserPlus size={24} color="white" />
                    </div>
                    <h2>Create Account</h2>
                    <p>Join My Polyglot Tutor today</p>
                </div>

                {/* ── 인앱 브라우저 안내 배너 ────────────────────────────────
                    error 상태가 'inapp'일 때는 일반 에러 대신
                    카카오톡 내장 브라우저 전용 안내 메시지를 보여줍니다.
                ─────────────────────────────────────────────────────────── */}
                {error === 'inapp' ? (
                    <div className="auth-inapp-warning">
                        <Smartphone size={20} />
                        <div>
                            <strong>카카오톡 브라우저에서는 Google 로그인이 불가합니다.</strong>
                            <p>우측 하단 <strong>[⋮]</strong> 메뉴 → <strong>'기본 브라우저로 열기'</strong>를 선택하신 후 다시 시도해 주세요.</p>
                        </div>
                    </div>
                ) : error && (
                    <div className="auth-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSignup} className="auth-form">
                    <div className="input-wrapper">
                        <label className="input-label">Nickname <span className="required-star">*</span></label>
                        <div className="input-group">
                            <User size={18} className="input-icon" />
                            <input
                                type="text"
                                placeholder="홍길동"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">Email address <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Mail size={18} className="input-icon" />
                            <input
                                type="email"
                                placeholder="hello@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">Phone</label>
                        <div className="input-group">
                            <Phone size={18} className="input-icon" />
                            <input
                                type="tel"
                                placeholder="010-0000-0000"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">Address</label>
                        <div className="input-group">
                            <MapPin size={18} className="input-icon" />
                            <input
                                type="text"
                                placeholder="Seoul, Korea"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">Password <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input
                                type="password"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">Confirm Password <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input
                                type="password"
                                placeholder="Confirm your password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={isLoading} style={{ marginTop: '10px' }}>
                        {isLoading ? 'Processing...' : 'Sign Up'}
                    </button>
                </form>

                <div className="auth-divider">OR</div>

                <button className="google-btn" onClick={handleGoogleLogin} disabled={isLoading}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
                    Sign up with Google
                </button>

                <div className="auth-footer">
                    <p>Already have an account? <span onClick={onSwitchToLogin}>Log In</span></p>
                </div>
            </div>
        </div>
    );
}

export default Signup;
