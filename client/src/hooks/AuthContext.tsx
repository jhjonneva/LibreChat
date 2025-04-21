import {
  useMemo,
  useState,
  useEffect,
  ReactNode,
  useContext,
  useCallback,
  createContext,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { setTokenHeader, SystemRoles } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import {
  useGetRole,
  useGetUserQuery,
  useLoginUserMutation,
  useLogoutUserMutation,
  useRefreshTokenMutation,
} from '~/data-provider';
import { TAuthConfig, TUserContext, TAuthContext, TResError } from '~/common';
import useTimeout from './useTimeout';
import store from '~/store';

const AuthContext = createContext<TAuthContext | undefined>(undefined);

// Singleton promise for refresh token to prevent race conditions
let refreshPromise: Promise<any> | null = null;
let isRefreshing = false;

const AuthContextProvider = ({
  authConfig,
  children,
}: {
  authConfig?: TAuthConfig;
  children: ReactNode;
}) => {
  const [user, setUser] = useRecoilState(store.user);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const logoutRedirectRef = useRef<string | undefined>(undefined);
  const isSamlRedirectRef = useRef<boolean>(false);

  const { data: userRole = null } = useGetRole(SystemRoles.USER, {
    enabled: !!(isAuthenticated && (user?.role ?? '')),
  });
  const { data: adminRole = null } = useGetRole(SystemRoles.ADMIN, {
    enabled: !!(isAuthenticated && user?.role === SystemRoles.ADMIN),
  });

  const navigate = useNavigate();

  // Check if we're coming from a SAML redirect
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/c/new' && document.referrer.includes('/oauth/saml')) {
      isSamlRedirectRef.current = true;
      // Add a small delay for cookie propagation after SAML redirect
      setTimeout(() => {
        isSamlRedirectRef.current = false;
      }, 2000);
    }
  }, []);

  const setUserContext = useCallback(
    (userContext: TUserContext) => {
      const { token, isAuthenticated, user, redirect } = userContext;
      setUser(user);
      setToken(token);
      //@ts-ignore - ok for token to be undefined initially
      setTokenHeader(token);
      setIsAuthenticated(isAuthenticated);
      // Use a custom redirect if set
      const finalRedirect = logoutRedirectRef.current || redirect;
      // Clear the stored redirect
      logoutRedirectRef.current = undefined;
      if (finalRedirect == null) {
        return;
      }
      if (finalRedirect.startsWith('http://') || finalRedirect.startsWith('https://')) {
        window.location.href = finalRedirect;
      } else {
        navigate(finalRedirect, { replace: true });
      }
    },
    [navigate, setUser],
  );
  const doSetError = useTimeout({ callback: (error) => setError(error as string | undefined) });

  const loginUser = useLoginUserMutation({
    onSuccess: (data: t.TLoginResponse) => {
      const { user, token, twoFAPending, tempToken } = data;
      if (twoFAPending) {
        // Redirect to the two-factor authentication route.
        navigate(`/login/2fa?tempToken=${tempToken}`, { replace: true });
        return;
      }
      setError(undefined);
      setUserContext({ token, isAuthenticated: true, user, redirect: '/c/new' });
    },
    onError: (error: TResError | unknown) => {
      const resError = error as TResError;
      doSetError(resError.message);
      navigate('/login', { replace: true });
    },
  });
  const logoutUser = useLogoutUserMutation({
    onSuccess: (data) => {
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: data.redirect ?? '/login',
      });
    },
    onError: (error) => {
      doSetError((error as Error).message);
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: '/login',
      });
    },
  });
  const refreshToken = useRefreshTokenMutation();

  const logout = useCallback(
    (redirect?: string) => {
      if (redirect) {
        logoutRedirectRef.current = redirect;
      }
      logoutUser.mutate(undefined);
    },
    [logoutUser],
  );

  const userQuery = useGetUserQuery({ enabled: !!(token ?? '') });

  const login = (data: t.TLoginUser) => {
    loginUser.mutate(data);
  };

  // Race-condition-safe refresh token implementation
  const silentRefresh = useCallback(() => {
    if (authConfig?.test === true) {
      console.log('Test mode. Skipping silent refresh.');
      return Promise.resolve(null);
    }

    // If we're coming from a SAML redirect, add a small delay
    if (isSamlRedirectRef.current) {
      console.log('SAML redirect detected, adding delay before refresh');
      const delay = 500; // 500ms delay for cookie propagation
      
      // Return a promise that resolves after the delay
      return new Promise(resolve => {
        setTimeout(() => {
          // After delay, perform the refresh with the singleton pattern
          if (refreshPromise) {
            resolve(refreshPromise);
          } else {
            performRefresh().then(resolve);
          }
        }, delay);
      });
    }

    // Use existing promise if one is in flight
    if (refreshPromise) {
      console.log('Using existing refresh promise');
      return refreshPromise;
    }

    return performRefresh();
  }, []);

  // The actual refresh token operation
  const performRefresh = () => {
    console.log('Starting new refresh token request');
    isRefreshing = true;
    
    // Create a new promise for this refresh operation
    refreshPromise = new Promise((resolve) => {
      refreshToken.mutate(undefined, {
        onSuccess: (data: t.TRefreshTokenResponse | undefined) => {
          const { user, token = '' } = data ?? {};
          if (token) {
            setUserContext({ token, isAuthenticated: true, user });
            resolve(data);
          } else {
            console.log('Token is not present. User is not authenticated.');
            if (authConfig?.test === true) {
              resolve(null);
              return;
            }
            navigate('/login');
            resolve(null);
          }
          // Reset the singleton after completion
          setTimeout(() => {
            refreshPromise = null;
            isRefreshing = false;
          }, 100);
        },
        onError: (error) => {
          console.log('refreshToken mutation error:', error);
          if (authConfig?.test === true) {
            resolve(null);
            return;
          }
          navigate('/login');
          resolve(null);
          // Reset the singleton after completion
          setTimeout(() => {
            refreshPromise = null;
            isRefreshing = false;
          }, 100);
        },
      });
    });
    
    return refreshPromise;
  };

  useEffect(() => {
    if (userQuery.data) {
      setUser(userQuery.data);
    } else if (userQuery.isError) {
      doSetError((userQuery.error as Error).message);
      navigate('/login', { replace: true });
    }
    if (error != null && error && isAuthenticated) {
      doSetError(undefined);
    }
    if (token == null || !token || !isAuthenticated) {
      silentRefresh();
    }
  }, [
    token,
    isAuthenticated,
    userQuery.data,
    userQuery.isError,
    userQuery.error,
    error,
    setUser,
    navigate,
    silentRefresh,
    setUserContext,
  ]);

  useEffect(() => {
    const handleTokenUpdate = (event) => {
      console.log('tokenUpdated event received event');
      const newToken = event.detail;
      setUserContext({
        token: newToken,
        isAuthenticated: true,
        user: user,
      });
    };

    window.addEventListener('tokenUpdated', handleTokenUpdate);

    return () => {
      window.removeEventListener('tokenUpdated', handleTokenUpdate);
    };
  }, [setUserContext, user]);

  // Make the provider update only when it should
  const memoedValue = useMemo(
    () => ({
      user,
      token,
      error,
      login,
      logout,
      setError,
      roles: {
        [SystemRoles.USER]: userRole,
        [SystemRoles.ADMIN]: adminRole,
      },
      isAuthenticated,
    }),

    [user, error, isAuthenticated, token, userRole, adminRole],
  );

  return <AuthContext.Provider value={memoedValue}>{children}</AuthContext.Provider>;
};

const useAuthContext = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuthContext should be used inside AuthProvider');
  }

  return context;
};

export { AuthContextProvider, useAuthContext, AuthContext };
