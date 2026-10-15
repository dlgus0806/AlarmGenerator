import { useCallback, useEffect, useState } from 'react';

export interface Identity {
  email: string;
  name: string;
  userId: string;
}

export interface AuthState {
  /** 로딩 중(초기 확인 전)인지 */
  loading: boolean;
  authenticated: boolean;
  identity: Identity | null;
  /** 백엔드에 OAuth가 구성돼 있는지(미구성이면 로그인 없이 기존 방식 동작) */
  configured: boolean;
}

const API = import.meta.env.VITE_DISCOVER_API ?? '';

/**
 * /api/auth/me 로 로그인 상태를 확인한다.
 * - 200 {authenticated:true} → 로그인됨
 * - 401 {authenticated:false} → 미로그인 (OAuth는 구성됨)
 * - 그 외/네트워크 실패 → OAuth 미구성으로 간주(configured=false), 기존 동작 유지
 */
export function useAuth(): AuthState & { login: () => void; logout: () => Promise<void>; refresh: () => void } {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    identity: null,
    configured: false,
  });

  const refresh = useCallback(() => {
    let alive = true;
    fetch(`${API}/api/auth/me`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          identity?: Identity;
        };
        if (!alive) return;
        if (res.ok && body.authenticated) {
          setState({ loading: false, authenticated: true, identity: body.identity ?? null, configured: true });
        } else if (res.status === 401 && body.authenticated === false) {
          // 인증 라우트가 "미로그인"이라고 명시적으로 답한 경우에만 로그인 게이트를 켠다.
          setState({ loading: false, authenticated: false, identity: null, configured: true });
        } else {
          // 404(로컬 dev 서버엔 인증 라우트가 없음)·프록시 오류 등은 OAuth 미구성으로 본다.
          // 화면 게이트만 풀리는 것이고, 배포 백엔드는 여전히 세션 없는 /api/* 요청을 401로 막는다.
          setState({ loading: false, authenticated: false, identity: null, configured: false });
        }
      })
      .catch(() => {
        if (!alive) return;
        setState({ loading: false, authenticated: false, identity: null, configured: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

  const login = useCallback(() => {
    // OAuth 는 최상위 내비게이션이어야 하므로 페이지 이동.
    window.location.href = `${API}/api/auth/slack/login`;
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API}/api/auth/logout`, { method: 'GET', credentials: 'same-origin' }).catch(() => {});
    setState({ loading: false, authenticated: false, identity: null, configured: true });
  }, []);

  return { ...state, login, logout, refresh };
}
