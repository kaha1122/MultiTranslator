import React, { useState } from 'react';
import { auth, db, googleProvider } from '../../firebase/config';
import { createUserWithEmailAndPassword, signInWithPopup, getAdditionalUserInfo } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserPlus, Mail, Lock, AlertCircle, User, Phone, MapPin } from 'lucide-react';
import './Auth.css';

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
            // 과거에 찌꺼기 데이터가 남아 있어도, 온보딩(팝업)을 다시 보게끔 강제로 리셋해 줍니다.
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

                {error && (
                    <div className="auth-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSignup} className="auth-form">
                    <div className="input-group">
                        <User size={18} className="input-icon" />
                        <input
                            type="text"
                            placeholder="Nickname (Required)"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Mail size={18} className="input-icon" />
                        <input
                            type="email"
                            placeholder="Email address (Required)"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Phone size={18} className="input-icon" />
                        <input
                            type="tel"
                            placeholder="Phone (Optional)"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />
                    </div>

                    <div className="input-group">
                        <MapPin size={18} className="input-icon" />
                        <input
                            type="text"
                            placeholder="Address (Optional)"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                        />
                    </div>

                    <div className="input-group">
                        <Lock size={18} className="input-icon" />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Lock size={18} className="input-icon" />
                        <input
                            type="password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={isLoading}>
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
