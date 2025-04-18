import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import type { ContextType } from '~/common';
import {
  AgentsMapContext,
  AssistantsMapContext,
  FileMapContext,
  SearchContext,
  SetConvoProvider,
} from '~/Providers';
import { useAuthContext, useAssistantsMap, useAgentsMap, useFileMap, useSearch } from '~/hooks';
import TermsAndConditionsModal from '~/components/ui/TermsAndConditionsModal';
import { useUserTermsQuery, useGetStartupConfig } from '~/data-provider';
import { Nav, MobileNav } from '~/components/Nav';
import { Banner } from '~/components/Banners';

export default function Root() {
  const [showTerms, setShowTerms] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const [navVisible, setNavVisible] = useState(() => {
    const savedNavVisible = localStorage.getItem('navVisible');
    return savedNavVisible !== null ? JSON.parse(savedNavVisible) : true;
  });
  const [isAuthComplete, setIsAuthComplete] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const location = useLocation();

  const { isAuthenticated, token, logout } = useAuthContext();

  // Check if we just completed auth
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authComplete = params.get('auth_complete') === 'true';

    if (authComplete) {
      setIsAuthComplete(true);
      // Clear the auth_complete parameter from URL
      params.delete('auth_complete');
      const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      window.history.replaceState({}, document.title, newUrl);

      // Wait for authentication to settle with a longer delay
      setTimeout(() => {
        setIsInitialized(true);
      }, 1200);
    } else {
      setIsInitialized(true);
    }
  }, [location.search]);

  // Add a retry mechanism for when auth is complete but token might not be ready
  useEffect(() => {
    if (isAuthComplete && isInitialized && !token && retryCount < 5) {
      const retryTimer = setTimeout(() => {
        console.log(`Retrying authentication check (attempt ${retryCount + 1}/5)...`);
        setRetryCount(prev => prev + 1);
        // Force a re-render to check auth state again
        setIsInitialized(false);
        setTimeout(() => setIsInitialized(true), 500);
      }, 1000);
      return () => clearTimeout(retryTimer);
    }
  }, [isAuthComplete, isInitialized, token, retryCount]);

  // Only enable data fetching when initialized and we have a token
  const shouldFetch = isAuthenticated && isInitialized && !!token;

  // For now, pass standard props to existing hooks
  // We'll control the data fetching by manually triggering it after SAML auth
  const assistantsMap = useAssistantsMap({ isAuthenticated: shouldFetch });
  const agentsMap = useAgentsMap({ isAuthenticated: shouldFetch });
  const fileMap = useFileMap({ isAuthenticated: shouldFetch });
  const search = useSearch({ isAuthenticated: shouldFetch });

  // If auth is complete but we're not initialized, show loading state
  useEffect(() => {
    if (isAuthComplete && !isInitialized) {
      console.log('Auth complete, waiting for session to initialize before loading data...');
    } else if (isAuthComplete && isInitialized && !token) {
      console.log('Session initialized but token not available yet, may retry...');
    } else if (isAuthComplete && isInitialized && token) {
      console.log('Authentication complete and token available, ready to fetch data');
    }
  }, [isAuthComplete, isInitialized, token]);

  const { data: config } = useGetStartupConfig();
  const { data: termsData } = useUserTermsQuery({
    enabled: isAuthenticated && config?.interface?.termsOfService?.modalAcceptance === true,
  });

  useEffect(() => {
    if (termsData) {
      setShowTerms(!termsData.termsAccepted);
    }
  }, [termsData]);

  const handleAcceptTerms = () => {
    setShowTerms(false);
  };

  // Pass the desired redirect parameter to logout
  const handleDeclineTerms = () => {
    setShowTerms(false);
    logout('/login?redirect=false');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SetConvoProvider>
      <SearchContext.Provider value={search}>
        <FileMapContext.Provider value={fileMap}>
          <AssistantsMapContext.Provider value={assistantsMap}>
            <AgentsMapContext.Provider value={agentsMap}>
              <Banner onHeightChange={setBannerHeight} />
              <div className="flex" style={{ height: `calc(100dvh - ${bannerHeight}px)` }}>
                <div className="relative z-0 flex h-full w-full overflow-hidden">
                  <Nav navVisible={navVisible} setNavVisible={setNavVisible} />
                  <div className="relative flex h-full max-w-full flex-1 flex-col overflow-hidden">
                    <MobileNav setNavVisible={setNavVisible} />
                    <Outlet context={{ navVisible, setNavVisible } satisfies ContextType} />
                  </div>
                </div>
              </div>
            </AgentsMapContext.Provider>
            {config?.interface?.termsOfService?.modalAcceptance === true && (
              <TermsAndConditionsModal
                open={showTerms}
                onOpenChange={setShowTerms}
                onAccept={handleAcceptTerms}
                onDecline={handleDeclineTerms}
                title={config.interface.termsOfService.modalTitle}
                modalContent={config.interface.termsOfService.modalContent}
              />
            )}
          </AssistantsMapContext.Provider>
        </FileMapContext.Provider>
      </SearchContext.Provider>
    </SetConvoProvider>
  );
}
