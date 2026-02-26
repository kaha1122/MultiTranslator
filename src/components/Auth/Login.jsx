import React, { useState } from 'react';
import { auth, googleProvider } from '../../firebase/config';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { LogIn, Mail, Lock, AlertCircle } from 'lucide-react';
import './Auth.css';

function Login({ onSwitchToSignup }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            console.error(err);
            setError(`Login failed: ${err.code}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError('');
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`Google login failed: ${err.code}`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-icon-circle">
                        <LogIn size={24} color="white" />
                    </div>
                    <h2>Welcome Back</h2>
                    <p>Please log in to continue</p>
                </div>

                {error && (
                    <div className="auth-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleLogin} className="auth-form">
                    <div className="input-group">
                        <Mail size={18} className="input-icon" />
                        <input
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
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

                    <button type="submit" className="auth-submit-btn" disabled={isLoading}>
                        {isLoading ? 'Processing...' : 'Log In'}
                    </button>
                </form>

                <div className="auth-divider">OR</div>

                <button className="google-btn" onClick={handleGoogleLogin} disabled={isLoading}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
                    Sign in with Google
                </button>

                <div className="auth-footer">
                    <p>Don't have an account? <span onClick={onSwitchToSignup}>Sign Up</span></p>
                </div>
            </div>
        </div>
    );
}

export default Login;
